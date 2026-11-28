const db = require('../db');
const wallet = require('./wallet');
const membership = require('./membership');
const { getSettings } = require('./settings');
const { conflict, notFound, badRequest } = require('../lib/errors');

/**
 * Imbalan tugas pengguna. Hadiah berupa KOIN, jumlahnya diatur admin (utask_*).
 *   Pemula (sekali seumur akun): avatar, cocokkan, ikuti, isi ulang pertama, VIP, selesaikan semua tugas pemula
 *   Harian (reset 00:00 WIB):   check-in, cocokkan, chat teman baru, kirim hadiah, sukai momen, selesaikan semua tugas harian
 */
const TODAY = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;
const DAY = (col) => `(${col} AT TIME ZONE 'Asia/Jakarta')::date = ${TODAY}`;

const BEGINNER = ['avatar', 'match', 'follow', 'topup', 'vip'];
const DAILY = ['checkin', 'match_day', 'chat', 'gift', 'momlike'];

async function counts(client, userId) {
  const { rows } = await client.query(
    `SELECT
       (u.avatar_url IS NOT NULL)::int AS avatar,
       u.topup_total,
       (SELECT COUNT(*) FROM (SELECT target_id FROM likes WHERE user_id = $1
                              UNION SELECT host_id FROM match_skips WHERE user_id = $1) x)::int AS swipes_all,
       (SELECT COUNT(*) FROM follows f JOIN users t ON t.id = f.followee_id WHERE f.follower_id = $1 AND t.role = 'host')::int AS follows,
       (SELECT COUNT(*) FROM (SELECT target_id FROM likes WHERE user_id = $1 AND ${DAY('created_at')}
                              UNION SELECT host_id FROM match_skips WHERE user_id = $1 AND ${DAY('created_at')}) x)::int AS swipes_day,
       (SELECT COUNT(*) FROM user_checkins WHERE user_id = $1 AND day = ${TODAY})::int AS checkin,
       (SELECT COUNT(DISTINCT c.id) FROM conversations c JOIN messages m ON m.conversation_id = c.id AND m.sender_id = $1 AND m.type = 'text'
          WHERE c.user_id = $1 AND ${DAY('c.created_at')} AND ${DAY('m.created_at')})::int AS chats,
       (SELECT COUNT(*) FROM messages WHERE sender_id = $1 AND type = 'gift' AND ${DAY('created_at')})::int AS gifts,
       (SELECT COUNT(*) FROM moment_likes WHERE user_id = $1 AND ${DAY('created_at')})::int AS momlikes,
       ${TODAY}::text AS today,
       EXTRACT(EPOCH FROM (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') + interval '1 day') - (now() AT TIME ZONE 'Asia/Jakarta'))::int AS reset_in
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  return rows[0];
}

function definitions(s, c, claimedOnce, claimedToday) {
  const vip = membership.vipOf(Number(c.topup_total), s.vip_thresholds);
  const cap = (n, t) => Math.min(t, n);
  const b = [
    { key: 'avatar', group: 'beginner', title: 'Unggah avatar asli', reward: s.utask_reward_avatar, progress: c.avatar, target: 1, period: 'once', go: 'profile' },
    { key: 'match', group: 'beginner', title: `Cocokkan (${cap(c.swipes_all, 3)}/3) kali`, reward: s.utask_reward_match, progress: cap(c.swipes_all, 3), target: 3, period: 'once', go: 'match' },
    { key: 'follow', group: 'beginner', title: `Ikuti gadis-gadis (${cap(c.follows, 3)}/3)`, reward: s.utask_reward_follow, progress: cap(c.follows, 3), target: 3, period: 'once', go: 'home' },
    { key: 'topup', group: 'beginner', title: 'Selesaikan isi ulang pertama Anda', reward: s.utask_reward_topup, progress: Number(c.topup_total) > 0 ? 1 : 0, target: 1, period: 'once', go: 'topup' },
    { key: 'vip', group: 'beginner', title: 'Jadi VIP', reward: s.utask_reward_vip, progress: vip > 0 ? 1 : 0, target: 1, period: 'once', go: 'vip' },
  ];
  const bDone = b.filter((t) => claimedOnce.has(t.key)).length;
  b.push({ key: 'beginner_all', group: 'beginner', title: `Selesaikan (${bDone}/${BEGINNER.length}) tugas pemula`, reward: s.utask_reward_beginner_all, progress: bDone, target: BEGINNER.length, period: 'once', go: 'none' });
  const d = [
    { key: 'checkin', group: 'daily', title: 'Check-in harian', reward: s.utask_reward_checkin, progress: c.checkin, target: 1, period: c.today, go: 'checkin' },
    { key: 'match_day', group: 'daily', title: `Cocokkan (${cap(c.swipes_day, 10)}/10) kali`, reward: s.utask_reward_match_day, progress: cap(c.swipes_day, 10), target: 10, period: c.today, go: 'match' },
    { key: 'chat', group: 'daily', title: `Chat dengan (${cap(c.chats, 3)}/3) teman baru`, reward: s.utask_reward_chat, progress: cap(c.chats, 3), target: 3, period: c.today, go: 'home' },
    { key: 'gift', group: 'daily', title: `Berikan (${cap(c.gifts, 1)}/1) hadiah`, reward: s.utask_reward_gift, progress: cap(c.gifts, 1), target: 1, period: c.today, go: 'home' },
    { key: 'momlike', group: 'daily', title: `Sukai (${cap(c.momlikes, 3)}/3) momen`, reward: s.utask_reward_momlike, progress: cap(c.momlikes, 3), target: 3, period: c.today, go: 'moments' },
  ];
  const dDone = d.filter((t) => claimedToday.has(t.key)).length;
  d.push({ key: 'daily_all', group: 'daily', title: `Selesaikan (${dDone}/${DAILY.length}) tugas harian`, reward: s.utask_reward_daily_all, progress: dDone, target: DAILY.length, period: c.today, go: 'none' });
  return [...b, ...d];
}

async function load(client, userId) {
  const [s, c, { rows }] = await Promise.all([
    getSettings(client),
    counts(client, userId),
    client.query(`SELECT task, period FROM user_task_claims WHERE user_id = $1`, [userId]),
  ]);
  const once = new Set(rows.filter((r) => r.period === 'once').map((r) => r.task));
  const daily = new Set(rows.filter((r) => r.period === c.today).map((r) => r.task));
  return { s, c, once, daily, defs: definitions(s, c, once, daily) };
}

async function list(client, userId) {
  const { defs, once, daily, c } = await load(client, userId);
  return {
    tasks: defs.map((t) => ({
      key: t.key,
      group: t.group,
      title: t.title,
      reward: t.reward,
      progress: t.progress,
      target: t.target,
      go: t.go,
      state: (t.period === 'once' ? once : daily).has(t.key) ? 'done' : t.progress >= t.target ? 'claimable' : 'todo',
    })),
    resetIn: c.reset_in,
  };
}

async function claim(userId, key) {
  return db.tx(async (client) => {
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]); // cegah klaim ganda
    const { defs } = await load(client, userId);
    const t = defs.find((x) => x.key === key);
    if (!t) throw notFound('Tugas tidak ditemukan');
    if (t.progress < t.target) throw badRequest('Tugas belum selesai', 'TASK_INCOMPLETE');
    const ins = await client.query(
      `INSERT INTO user_task_claims (user_id, task, period, reward) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userId, t.key, t.period, t.reward]
    );
    if (!ins.rowCount) throw conflict('Hadiah tugas ini sudah diklaim', 'ALREADY_CLAIMED');
    if (t.reward > 0) await wallet.creditCoins(client, userId, t.reward, 'task_reward', { type: 'task', note: t.key });
    return { reward: t.reward };
  });
}

module.exports = { list, claim };

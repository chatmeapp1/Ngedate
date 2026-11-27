const db = require('../db');
const wallet = require('./wallet');
const { getSettings } = require('./settings');
const { conflict, notFound, badRequest } = require('../lib/errors');

/**
 * Tugas host. Hadiah berupa DIAMOND (mata uang host), jumlahnya diatur admin (task_reward_*).
 *   Tugas pemula (sekali seumur akun):
 *     moment  posting 1 momen berfoto dan lolos review admin
 *     photos  3 foto album lolos review admin
 *   Tugas harian (reset 00:00 WIB):
 *     checkin check-in harian
 *     like    menyukai N pengguna hari ini
 */
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;
const PHOTO_TARGET = 3;

async function counts(client, hostId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM moments WHERE host_id = $1 AND status = 'approved' AND image_url IS NOT NULL)::int AS moments,
       (SELECT COUNT(*) FROM user_photos WHERE user_id = $1 AND status = 'approved')::int AS photos,
       (SELECT COUNT(DISTINCT l.target_id) FROM likes l JOIN users t ON t.id = l.target_id
          WHERE l.user_id = $1 AND t.role = 'user' AND (l.created_at AT TIME ZONE 'Asia/Jakarta')::date = ${TODAY_SQL})::int AS likes,
       ${TODAY_SQL}::text AS today,
       EXTRACT(EPOCH FROM (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') + interval '1 day') - (now() AT TIME ZONE 'Asia/Jakarta'))::int AS reset_in`,
    [hostId]
  );
  return rows[0];
}

function definitions(s, c) {
  return [
    { key: 'moment', group: 'beginner', title: 'Sapa: Posting 1 Momen berfoto & Lolos Review', reward: s.task_reward_moment, progress: Math.min(1, c.moments), target: 1, period: 'once', go: 'moment' },
    { key: 'photos', group: 'beginner', title: `Tampilkan Dirimu: Tambah (${Math.min(PHOTO_TARGET, c.photos)}/${PHOTO_TARGET}) Foto & Lolos Review`, reward: s.task_reward_photos, progress: Math.min(PHOTO_TARGET, c.photos), target: PHOTO_TARGET, period: 'once', go: 'photos' },
    { key: 'checkin', group: 'daily', title: 'Check-in', reward: s.task_reward_checkin, progress: 1, target: 1, period: c.today, go: 'checkin' },
    { key: 'like', group: 'daily', title: `Sukai (${Math.min(s.task_like_target, c.likes)}/${s.task_like_target}) pengguna`, reward: s.task_reward_like, progress: Math.min(s.task_like_target, c.likes), target: s.task_like_target, period: c.today, go: 'like' },
  ];
}

async function list(client, hostId) {
  const [s, c] = await Promise.all([getSettings(client), counts(client, hostId)]);
  const { rows } = await client.query(`SELECT task, period FROM host_task_claims WHERE host_id = $1`, [hostId]);
  const claimed = new Set(rows.map((r) => `${r.task}|${r.period}`));
  const tasks = definitions(s, c).map((t) => {
    const done = claimed.has(`${t.key}|${t.period}`);
    return {
      key: t.key,
      group: t.group,
      title: t.title,
      reward: t.reward,
      progress: t.progress,
      target: t.target,
      go: t.go,
      state: done ? 'done' : t.progress >= t.target ? 'claimable' : 'todo',
    };
  });
  return { tasks, resetIn: c.reset_in };
}

async function claim(hostId, key) {
  return db.tx(async (client) => {
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [hostId]); // cegah klaim ganda
    const [s, c] = await Promise.all([getSettings(client), counts(client, hostId)]);
    const t = definitions(s, c).find((x) => x.key === key);
    if (!t) throw notFound('Tugas tidak ditemukan');
    if (t.progress < t.target) throw badRequest('Tugas belum selesai', 'TASK_INCOMPLETE');
    const ins = await client.query(
      `INSERT INTO host_task_claims (host_id, task, period, reward) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [hostId, t.key, t.period, t.reward]
    );
    if (!ins.rowCount) throw conflict('Hadiah tugas ini sudah diklaim', 'ALREADY_CLAIMED');
    if (t.reward > 0) await wallet.creditDiamonds(client, hostId, t.reward, 'task_reward', { type: 'task', note: t.key });
    return { reward: t.reward };
  });
}

module.exports = { list, claim };

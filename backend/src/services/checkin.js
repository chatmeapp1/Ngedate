const db = require('../db');
const wallet = require('./wallet');
const { getSettings } = require('./settings');
const { conflict, forbidden, badRequest } = require('../lib/errors');

/**
 * Check-in harian untuk pengguna (bukan host): hari ke-1 sampai ke-7 berurutan, hadiah per hari dari
 * setting `checkin_rewards` (tiap hari satu token):
 *   coins:JUMLAH        koin ke saldo
 *   cards:JUMLAH        kredit pesan gratis (host tetap dibayar app, sama seperti kartu VIP)
 *   frame:MODEL:HARI    bingkai avatar sementara (MODEL 1 atau 2), otomatis lepas setelah HARI hari
 * Lewat satu hari = mulai lagi dari hari ke-1; setelah hari ke-7 mengulang. Hari mengikuti Asia/Jakarta.
 */
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;
const FRAME_MODELS = 2;

/** 'coins:10' | 'cards:5' | 'frame:1:3' -> objek; null jika tidak valid. */
function parseReward(token) {
  const p = String(token).trim().toLowerCase().split(':');
  const n = (x) => (/^\d+$/.test(x) ? Number(x) : NaN);
  if (p[0] === 'coins' && p.length === 2 && n(p[1]) >= 1 && n(p[1]) <= 1000) return { type: 'coins', amount: n(p[1]) };
  if (p[0] === 'cards' && p.length === 2 && n(p[1]) >= 1 && n(p[1]) <= 50) return { type: 'cards', amount: n(p[1]) };
  if (p[0] === 'frame' && p.length === 3 && n(p[1]) >= 1 && n(p[1]) <= FRAME_MODELS && n(p[2]) >= 1 && n(p[2]) <= 30) {
    return { type: 'frame', frame: n(p[1]), days: n(p[2]) };
  }
  return null;
}

/** Validasi setting dari admin: tepat 7 token, kembalikan array token bersih. */
function parseRewardList(value) {
  const tokens = (Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/)).map((t) => String(t).trim()).filter(Boolean);
  if (tokens.length !== 7) throw badRequest('Hadiah check-in: isi 7 hadiah (hari 1 sampai 7) dipisah koma');
  tokens.forEach((t, i) => {
    if (!parseReward(t)) {
      throw badRequest(`Hadiah hari ${i + 1} tidak valid ("${t}"). Pakai coins:10, cards:5, atau frame:1:3 (model 1-${FRAME_MODELS}, lama hari)`);
    }
  });
  return tokens.map((t) => t.toLowerCase());
}

async function status(client, userId) {
  const s = await getSettings(client);
  const rewards = s.checkin_rewards.map(parseReward);
  const { rows } = await client.query(
    `SELECT day::text AS day, streak_day, (day = ${TODAY_SQL}) AS today, (day = ${TODAY_SQL} - 1) AS yesterday
     FROM user_checkins WHERE user_id = $1 ORDER BY day DESC LIMIT 1`,
    [userId]
  );
  const last = rows[0];
  const claimedToday = !!(last && last.today);
  // hari berjalan: sudah klaim hari ini = hari klaim tadi; lanjut dari kemarin = berikutnya; selain itu 1
  let current;
  if (claimedToday) current = last.streak_day;
  else if (last && last.yesterday) current = (last.streak_day % 7) + 1;
  else current = 1;
  return {
    claimedToday,
    currentDay: current, // hari yang sedang / baru saja diklaim
    claimedDays: claimedToday ? current : current - 1, // kotak yang sudah bercentang pada siklus ini
    rewards,
    reward: rewards[current - 1],
  };
}

async function grant(client, userId, reward, day) {
  if (reward.type === 'coins') {
    await wallet.creditCoins(client, userId, reward.amount, 'checkin', { type: 'checkin', note: `Hari ke-${day}` });
  } else if (reward.type === 'cards') {
    await client.query(`UPDATE users SET checkin_cards = checkin_cards + $2 WHERE id = $1`, [userId, reward.amount]);
  } else {
    // bingkai sama yang masih aktif: perpanjang; model lain: ganti
    await client.query(
      `UPDATE users SET
         checkin_frame_until = CASE WHEN checkin_frame = $2 AND checkin_frame_until > now()
                                    THEN checkin_frame_until + make_interval(days => $3)
                                    ELSE now() + make_interval(days => $3) END,
         checkin_frame = $2
       WHERE id = $1`,
      [userId, reward.frame, reward.days]
    );
  }
}

async function claim(userId, role) {
  if (role !== 'user') throw forbidden('Check-in hanya untuk pengguna');
  const granted = await db.tx(async (client) => {
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]); // cegah klaim ganda bersamaan
    const st = await status(client, userId);
    if (st.claimedToday) throw conflict('Kamu sudah check-in hari ini', 'ALREADY_CHECKED_IN');
    await client.query(
      `INSERT INTO user_checkins (user_id, day, streak_day, coins, reward) VALUES ($1, ${TODAY_SQL}, $2, $3, $4)`,
      [userId, st.currentDay, st.reward.type === 'coins' ? st.reward.amount : 0, JSON.stringify(st.reward)]
    );
    await grant(client, userId, st.reward, st.currentDay);
    return { day: st.currentDay, granted: st.reward };
  });
  return { ...granted, ...(await status(db, userId)) };
}

module.exports = { status, claim, parseReward, parseRewardList };

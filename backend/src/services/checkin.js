const db = require('../db');
const wallet = require('./wallet');
const { getSettings } = require('./settings');
const { conflict, forbidden } = require('../lib/errors');

/**
 * Check-in harian untuk pengguna (bukan host): hari ke-1 sampai ke-7 berurutan, hadiah koin per hari
 * dari setting `checkin_rewards`. Lewat satu hari = mulai lagi dari hari ke-1; setelah hari ke-7 mengulang.
 * Hari mengikuti zona waktu Asia/Jakarta.
 */
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;

async function status(client, userId) {
  const s = await getSettings(client);
  const rewards = s.checkin_rewards;
  const { rows } = await client.query(
    `SELECT day::text AS day, streak_day, (day = ${TODAY_SQL}) AS today, (day = ${TODAY_SQL} - 1) AS yesterday
     FROM user_checkins WHERE user_id = $1 ORDER BY day DESC LIMIT 1`,
    [userId]
  );
  const last = rows[0];
  const claimedToday = !!(last && last.today);
  // hari berjalan: kalau sudah klaim hari ini = hari klaim tadi; kalau lanjut dari kemarin = berikutnya; selain itu 1
  let current;
  if (claimedToday) current = last.streak_day;
  else if (last && last.yesterday) current = (last.streak_day % 7) + 1;
  else current = 1;
  const claimedDays = claimedToday ? current : current - 1;
  return {
    claimedToday,
    currentDay: current, // hari yang sedang/ akan diklaim
    claimedDays, // jumlah hari yang sudah terisi tanda centang pada siklus ini
    rewards,
    reward: rewards[current - 1],
  };
}

async function claim(userId, role) {
  if (role !== 'user') throw forbidden('Check-in hanya untuk pengguna');
  const result = await db.tx(async (client) => {
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]); // cegah klaim ganda bersamaan
    const st = await status(client, userId);
    if (st.claimedToday) throw conflict('Kamu sudah check-in hari ini', 'ALREADY_CHECKED_IN');
    const coins = Number(st.reward);
    await client.query(
      `INSERT INTO user_checkins (user_id, day, streak_day, coins) VALUES ($1, ${TODAY_SQL}, $2, $3)`,
      [userId, st.currentDay, coins]
    );
    if (coins > 0) await wallet.creditCoins(client, userId, coins, 'checkin', { type: 'checkin', note: `Hari ke-${st.currentDay}` });
    return { coins, day: st.currentDay };
  });
  return { ...result, ...(await status(db, userId)) };
}

module.exports = { status, claim };

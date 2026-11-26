const db = require('../db');
const { getSettings } = require('./settings');

/**
 * Level (0-10) dan VIP (1-5) dihitung dari TOTAL top up koin pengguna (users.topup_total).
 * Ambang batas dapat diubah admin di Pengaturan (level_thresholds, vip_thresholds).
 * Kartu pesan gratis: pengguna VIP mengirim pesan ke host berbayar tanpa dipotong koin,
 * sebanyak free_cards_per_day per hari (hari Jakarta); host menerima free_card_host_diamonds dari app.
 */

// Awal hari ini di Asia/Jakarta (WIB), dipakai untuk menghitung kartu gratis harian
const DAY_START_SQL = `(date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`;

function parseList(value, fallback) {
  const arr = Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/).filter(Boolean);
  const nums = arr.map(Number);
  if (!nums.length || nums.some((n) => !Number.isFinite(n) || n < 0)) return fallback;
  return nums;
}

function levelOf(total, thresholds) {
  let level = 0;
  for (let i = 0; i < thresholds.length; i++) if (total >= thresholds[i]) level = i;
  return level;
}

function vipOf(total, thresholds) {
  return thresholds.filter((t) => total >= t).length;
}

function progress(total, from, to) {
  if (to === null || to === undefined) return 1;
  return Math.max(0, Math.min(1, (total - from) / (to - from)));
}

async function freeCardsUsed(client, userId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM messages WHERE sender_id = $1 AND free_card AND created_at >= ${DAY_START_SQL}`,
    [userId]
  );
  return rows[0].n;
}

/** Ringkasan keanggotaan satu pengguna (level, VIP, kartu gratis). */
async function summary(client, userId, settings) {
  const s = settings || (await getSettings(client));
  const { rows } = await client.query(`SELECT topup_total FROM users WHERE id = $1`, [userId]);
  const total = rows.length ? Number(rows[0].topup_total) : 0;
  const levels = s.level_thresholds;
  const vips = s.vip_thresholds;
  const level = levelOf(total, levels);
  const vip = vipOf(total, vips);
  const nextLevelAt = level < levels.length - 1 ? levels[level + 1] : null;
  const nextVipAt = vip < vips.length ? vips[vip] : null;
  const perDay = Number(s.free_cards_per_day);
  const used = vip > 0 ? await freeCardsUsed(client, userId) : 0;
  return {
    topupTotal: total,
    level,
    maxLevel: levels.length - 1,
    levelThresholds: levels,
    nextLevelAt,
    levelProgress: progress(total, levels[level], nextLevelAt),
    vip,
    maxVip: vips.length,
    vipThresholds: vips,
    nextVipAt,
    vipProgress: progress(total, vip > 0 ? vips[vip - 1] : 0, nextVipAt),
    freeCardsPerDay: perDay,
    freeCardsLeft: vip > 0 ? Math.max(0, perDay - used) : 0,
  };
}

/** Tambah total top up (hanya top up sungguhan, bukan penyesuaian). */
async function addTopup(client, userId, amount) {
  if (amount > 0) await client.query(`UPDATE users SET topup_total = topup_total + $2 WHERE id = $1`, [userId, amount]);
}

module.exports = { DAY_START_SQL, summary, addTopup, levelOf, vipOf, parseList, freeCardsUsed };

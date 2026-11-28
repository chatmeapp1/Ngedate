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
    `SELECT COUNT(*)::int AS n FROM messages WHERE sender_id = $1 AND free_card AND free_card_source IS DISTINCT FROM 'checkin' AND created_at >= ${DAY_START_SQL}`,
    [userId]
  );
  return rows[0].n;
}

/** Ringkasan keanggotaan satu pengguna (level, VIP, kartu gratis). */
// Penghasilan diamond host 7 hari terakhir (chat, gift, kartu gratis)
const WEEK_INCOME_SQL = `(SELECT COALESCE(SUM(l.amount), 0) FROM ledger l
  WHERE l.user_id = {id} AND l.currency = 'diamond' AND l.amount > 0
    AND l.reason IN ('chat_income', 'gift_income', 'free_card_income', 'media_income') AND l.created_at > now() - interval '7 days')`;
const weekIncomeSql = (idExpr) => WEEK_INCOME_SQL.replace('{id}', idExpr);

/** Bingkai yang terpasang: 'vip' | 'checkin' | null. Punya dua -> sesuai pilihan, awal VIP. */
function wornFrame(vip, checkinActive, choice) {
  if (vip > 0 && checkinActive) return choice === 'checkin' ? 'checkin' : 'vip';
  if (vip > 0) return 'vip';
  if (checkinActive) return 'checkin';
  return null;
}

async function summary(client, userId, settings) {
  const s = settings || (await getSettings(client));
  const { rows } = await client.query(`SELECT role, topup_total, checkin_cards, checkin_frame, frame_choice, (checkin_frame_until > now()) AS frame_active, checkin_frame_until, ${weekIncomeSql('users.id')} AS week_income FROM users WHERE id = $1`, [userId]);
  const isHost = rows.length && rows[0].role === 'host';
  // Host: level dari total pendapatan diamond; pengguna: level & VIP dari total top up koin
  const total = rows.length ? Number(isHost ? rows[0].week_income : rows[0].topup_total) : 0;
  const levels = isHost ? s.host_level_thresholds : s.level_thresholds;
  const vips = isHost ? [] : s.vip_thresholds;
  const level = levelOf(total, levels);
  const vip = vipOf(total, vips);
  const nextLevelAt = level < levels.length - 1 ? levels[level + 1] : null;
  const nextVipAt = vip < vips.length ? vips[vip] : null;
  const perDay = Number(s.free_cards_per_day);
  const used = vip > 0 ? await freeCardsUsed(client, userId) : 0;
  // Host: penghasilan diamond hari ini (hari WIB)
  let earnedToday = 0;
  if (isHost) {
    const { rows: td } = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE user_id = $1 AND currency = 'diamond' AND amount > 0
         AND reason IN ('chat_income', 'gift_income', 'free_card_income', 'media_income') AND created_at >= ${DAY_START_SQL}`,
      [userId]
    );
    earnedToday = Number(td[0].n);
  }
  return {
    kind: isHost ? 'host' : 'user',
    earnedToday,
    topupTotal: total, // untuk host: penghasilan diamond 7 hari terakhir
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
    // hadiah check-in
    checkinCards: rows.length ? Number(rows[0].checkin_cards) : 0,
    checkinFrame: rows.length && rows[0].frame_active ? Number(rows[0].checkin_frame) : 0,
    checkinFrameUntil: rows.length && rows[0].frame_active ? rows[0].checkin_frame_until : null,
    // bingkai yang terpasang di avatar: hanya satu. Punya keduanya -> sesuai pilihan (awal: VIP)
    frameWorn: wornFrame(vip, rows.length && rows[0].frame_active, rows.length ? rows[0].frame_choice : null),
    frameChoice: rows.length ? rows[0].frame_choice : null,
    // bingkai check-in yang sudah kedaluwarsa (untuk halaman Ransel): model + waktu berakhir
    checkinFrameExpired: rows.length && !rows[0].frame_active && Number(rows[0].checkin_frame) > 0 && rows[0].checkin_frame_until ? Number(rows[0].checkin_frame) : 0,
    checkinFrameExpiredAt: rows.length && !rows[0].frame_active && Number(rows[0].checkin_frame) > 0 ? rows[0].checkin_frame_until : null,
  };
}

/** Tambah total top up (hanya top up sungguhan, bukan penyesuaian). */
async function addTopup(client, userId, amount) {
  if (amount > 0) await client.query(`UPDATE users SET topup_total = topup_total + $2 WHERE id = $1`, [userId, amount]);
}

module.exports = { weekIncomeSql, DAY_START_SQL, summary, addTopup, levelOf, vipOf, parseList, freeCardsUsed };

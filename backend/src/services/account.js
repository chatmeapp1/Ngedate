const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const v = require('../lib/validate');
const wallet = require('./wallet');
const storage = require('../lib/storage');
const tokens = require('../lib/tokens');
const { ApiError, badRequest, forbidden, notFound, unauthorized, conflict } = require('../lib/errors');

const RESERVED = /^(admin|administrator|root|support|amora|system|deleted_.*)$/i;

async function loadUser(client, userId) {
  const { rows } = await client.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (!rows.length || rows[0].status === 'deleted') throw notFound('Akun tidak ditemukan');
  return rows[0];
}

// Akun yang belum pernah mengatur password (Login cepat) tidak diminta password lama
async function checkCurrentPassword(user, password) {
  if (user.password_set === false) return;
  const given = v.str(password, 'Password saat ini', { max: 100 });
  if (!(await bcrypt.compare(given, user.password_hash))) {
    throw unauthorized('Password saat ini salah', 'INVALID_CREDENTIALS');
  }
}

/** Ubah (atau atur pertama kali) password. Semua sesi lain keluar; sesi ini mendapat token baru. */
async function changePassword(userId, { currentPassword, newPassword }) {
  const next = v.str(newPassword, 'Password baru', { min: 6, max: 100 });
  const user = await loadUser(db, userId);
  await checkCurrentPassword(user, currentPassword);
  if (user.password_set !== false && (await bcrypt.compare(next, user.password_hash))) {
    throw badRequest('Password baru harus berbeda dari yang lama');
  }
  const hash = await bcrypt.hash(next, 10);
  await db.tx(async (client) => {
    await client.query(`UPDATE users SET password_hash = $2, password_set = true, updated_at = now() WHERE id = $1`, [userId, hash]);
    await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
  });
  const fresh = await loadUser(db, userId);
  return {
    accessToken: tokens.signAccessToken(fresh),
    refreshToken: await tokens.issueRefreshToken(userId),
  };
}

/** Ubah username (dipakai untuk "Login via Akun"). */
async function changeUsername(userId, raw) {
  const username = v.str(raw, 'Username', { min: 3, max: 30, pattern: /^[a-zA-Z0-9_.]+$/ }).toLowerCase();
  if (RESERVED.test(username)) throw badRequest('Username ini tidak tersedia');
  await loadUser(db, userId);
  try {
    const { rows } = await db.query(`UPDATE users SET username = $2, updated_at = now() WHERE id = $1 RETURNING username`, [userId, username]);
    return rows[0].username;
  } catch (e) {
    if (e.code === '23505') throw conflict('Username sudah dipakai orang lain', 'USERNAME_TAKEN');
    throw e;
  }
}

/** Keluar dari semua perangkat: semua refresh token dicabut. */
async function logoutAll(userId) {
  await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
}

/**
 * Hapus akun secara permanen. Data pribadi dihapus/dianonimkan; riwayat transaksi (ledger) dan
 * laporan dipertahankan untuk pembukuan & moderasi. Koin & diamond yang tersisa hangus.
 * Koin yang masih ditahan di percakapan dikembalikan ke pengirimnya dulu.
 * Hasil: { refunds: [{ conversationId, userId, hostId, amount, messageIds }] } (untuk pemberitahuan realtime)
 */
async function deleteAccount(userId, { confirm, password }) {
  if (String(confirm || '').trim().toUpperCase() !== 'HAPUS') {
    throw badRequest('Ketik HAPUS untuk mengonfirmasi penghapusan akun', 'CONFIRM_REQUIRED');
  }
  const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const files = [];

  const result = await db.tx(async (client) => {
    const { rows } = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const user = rows[0];
    if (!user || user.status === 'deleted') throw notFound('Akun tidak ditemukan');
    if (user.role === 'admin') throw forbidden('Akun admin tidak bisa dihapus dari aplikasi', 'ADMIN_PROTECTED');
    await checkCurrentPassword(user, password);

    // 1) Koin yang masih ditahan: kembalikan ke pengirimnya
    const refunds = [];
    const { rows: convs } = await client.query(
      `SELECT * FROM conversations WHERE user_id = $1 OR host_id = $1 ORDER BY id FOR UPDATE`,
      [userId]
    );
    for (const c of convs) {
      const { rows: held } = await client.query(
        `UPDATE messages SET payment_status = 'refunded', settled_at = now()
         WHERE conversation_id = $1 AND payment_status = 'held' RETURNING id, price`,
        [c.id]
      );
      if (!held.length) continue;
      const total = held.reduce((sum, r) => sum + Number(r.price), 0);
      await wallet.creditCoins(client, Number(c.user_id), total, 'chat_refund', {
        type: 'conversation',
        id: Number(c.id),
        note: 'Akun dihapus',
      });
      refunds.push({
        conversationId: Number(c.id),
        userId: Number(c.user_id),
        hostId: Number(c.host_id),
        amount: total,
        messageIds: held.map((r) => Number(r.id)),
      });
    }

    // 2) Saldo yang tersisa hangus (tercatat di ledger)
    const { rows: bal } = await client.query(`SELECT coins, diamonds FROM users WHERE id = $1`, [userId]);
    const coins = Number(bal[0].coins);
    const diamonds = Number(bal[0].diamonds);
    if (coins > 0) await wallet.debitCoins(client, userId, coins, 'account_deleted', { type: 'account', id: userId, note: 'Akun dihapus' });
    if (diamonds > 0) await wallet.debitDiamonds(client, userId, diamonds, 'account_deleted', { type: 'account', id: userId, note: 'Akun dihapus' });

    // 3) Kumpulkan file untuk dihapus
    if (user.avatar_url) files.push(user.avatar_url);
    if (user.pending_avatar_url) files.push(user.pending_avatar_url);
    const { rows: photos } = await client.query(`SELECT url FROM user_photos WHERE user_id = $1`, [userId]);
    photos.forEach((p) => files.push(p.url));
    const { rows: vf } = await client.query(`SELECT photo_urls FROM verifications WHERE user_id = $1`, [userId]);
    vf.forEach((r) => (r.photo_urls || []).forEach((u) => files.push(u)));

    // 4) Hapus data pribadi & hubungan sosial
    await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM device_accounts WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1`, [userId]);
    await client.query(`DELETE FROM likes WHERE user_id = $1 OR target_id = $1`, [userId]);
    await client.query(`DELETE FROM user_photos WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1`, [userId]);
    await client.query(`UPDATE verifications SET photo_urls = '{}' WHERE user_id = $1`, [userId]);
    await client.query(`UPDATE host_profiles SET wa_number = NULL, wa_enabled = false WHERE user_id = $1`, [userId]);

    // 5) Anonimkan akun
    await client.query(
      `UPDATE users SET
         status = 'deleted', deleted_at = now(),
         username = $2, email = NULL, display_name = 'Akun dihapus',
         avatar_url = NULL, pending_avatar_url = NULL, bio = NULL, birth_date = NULL,
         gender = NULL, country_code = NULL, tags = '{}', verified = false,
         password_hash = $3, password_set = false, updated_at = now()
       WHERE id = $1`,
      [userId, `deleted_${userId}`, randomHash]
    );
    return { refunds };
  });

  // Hapus file dari penyimpanan (gagal menghapus tidak membatalkan penghapusan akun)
  await Promise.all(files.map((u) => storage.remove(u).catch(() => {})));
  return result;
}

module.exports = { changePassword, changeUsername, logoutAll, deleteAccount };

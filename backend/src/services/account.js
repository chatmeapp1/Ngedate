const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const v = require('../lib/validate');
const wallet = require('./wallet');
const storage = require('../lib/storage');
const tokens = require('../lib/tokens');
const { generateRecoveryCode, normalizeRecoveryCode } = require('../lib/recovery');
const { ApiError, badRequest, forbidden, notFound, unauthorized } = require('../lib/errors');

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
  // Kode pemulihan dibuat otomatis saat password pertama kali diatur (ditampilkan sekali saja)
  const recoveryCode = user.recovery_hash ? null : generateRecoveryCode();
  const recoveryHash = recoveryCode ? await bcrypt.hash(normalizeRecoveryCode(recoveryCode), 10) : null;
  await db.tx(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, password_set = true, must_change_password = false,
         recovery_hash = COALESCE($3, recovery_hash), updated_at = now() WHERE id = $1`,
      [userId, hash, recoveryHash]
    );
    await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
  });
  const fresh = await loadUser(db, userId);
  return {
    accessToken: tokens.signAccessToken(fresh),
    refreshToken: await tokens.issueRefreshToken(userId),
    recoveryCode,
  };
}

const MAX_RECOVERY_TRIES = 5; // salah 5 kali: kunci 1 jam
const RECOVERY_LOCK = '1 hour';
const DUMMY_HASH = bcrypt.hashSync('tidak-ada', 10); // supaya waktu respons sama walau akun tidak ada

/**
 * Lupa password: ganti password dengan kode pemulihan. Kode lama langsung diganti kode baru (dikembalikan sekali),
 * semua sesi keluar. Pesan galat sengaja sama untuk akun yang tidak ada / tanpa kode / kode salah.
 */
async function resetWithRecovery({ login, code, newPassword }) {
  const id = v.str(login, 'ID pengguna', { max: 120 }).toLowerCase();
  const next = v.str(newPassword, 'Password baru', { min: 6, max: 100 });
  const normalized = normalizeRecoveryCode(code);
  const fail = () => unauthorized('Kode pemulihan salah, atau akun tidak punya kode pemulihan', 'INVALID_RECOVERY');

  const byId = /^\d{1,15}$/.test(id);
  const { rows } = byId
    ? await db.query(`SELECT * FROM users WHERE id = $1`, [id])
    : await db.query(`SELECT * FROM users WHERE username = $1 OR email = $1`, [id]);
  const user = rows[0];
  if (!user || user.status === 'deleted' || !user.recovery_hash) {
    await bcrypt.compare(normalized || 'x', DUMMY_HASH);
    throw fail();
  }
  if (user.recovery_locked_until && new Date(user.recovery_locked_until) > new Date()) {
    throw new ApiError(429, 'RECOVERY_LOCKED', 'Terlalu banyak percobaan. Coba lagi dalam 1 jam, atau hubungi admin.');
  }
  if (user.status !== 'active') throw forbidden('Akun ditangguhkan', 'SUSPENDED');
  if (!normalized || !(await bcrypt.compare(normalized, user.recovery_hash))) {
    await db.query(
      `UPDATE users SET recovery_failed = recovery_failed + 1,
         recovery_locked_until = CASE WHEN recovery_failed + 1 >= $2 THEN now() + interval '${RECOVERY_LOCK}' ELSE recovery_locked_until END
       WHERE id = $1`,
      [user.id, MAX_RECOVERY_TRIES]
    );
    throw fail();
  }

  const newCode = generateRecoveryCode();
  const hash = await bcrypt.hash(next, 10);
  await db.tx(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, password_set = true, must_change_password = false,
         recovery_hash = $3, recovery_failed = 0, recovery_locked_until = NULL, updated_at = now() WHERE id = $1`,
      [user.id, hash, await bcrypt.hash(normalizeRecoveryCode(newCode), 10)]
    );
    await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [user.id]);
  });
  return { recoveryCode: newCode };
}

/** Admin: atur ulang password pengguna ke password sementara (ditampilkan sekali). Pengguna wajib menggantinya setelah masuk. */
async function adminResetPassword(userId) {
  const { generateTempPassword } = require('../lib/recovery');
  const user = await loadUser(db, userId);
  if (user.role === 'admin') throw forbidden('Akun admin tidak bisa diatur ulang dari sini');
  const temp = generateTempPassword();
  const hash = await bcrypt.hash(temp, 10);
  await db.tx(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, password_set = true, must_change_password = true, updated_at = now() WHERE id = $1`,
      [userId, hash]
    );
    await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
  });
  return { tempPassword: temp, userId: Number(userId) };
}

/** Buat kode pemulihan baru (kode lama tidak berlaku lagi). Wajib password; akun harus sudah punya password. */
async function regenerateRecovery(userId, { password }) {
  const user = await loadUser(db, userId);
  if (user.password_set === false) throw badRequest('Atur password dulu sebelum membuat kode pemulihan', 'PASSWORD_REQUIRED');
  await checkCurrentPassword(user, password);
  const code = generateRecoveryCode();
  await db.query(
    `UPDATE users SET recovery_hash = $2, recovery_failed = 0, recovery_locked_until = NULL, updated_at = now() WHERE id = $1`,
    [userId, await bcrypt.hash(normalizeRecoveryCode(code), 10)]
  );
  return { recoveryCode: code };
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

    // Diamond yang sedang diproses untuk penarikan tidak boleh hilang begitu saja
    const { rows: pendingW } = await client.query(`SELECT 1 FROM withdrawals WHERE user_id = $1 AND status = 'pending'`, [userId]);
    if (pendingW.length) {
      throw new ApiError(409, 'WITHDRAWAL_PENDING', 'Masih ada penarikan diamond yang diproses. Tunggu selesai atau batalkan dulu sebelum menghapus akun.');
    }

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
    // Rekening penarikan dihapus; catatan penarikan lama (pembukuan) hanya menyisakan 4 digit terakhir
    await client.query(`DELETE FROM payout_accounts WHERE user_id = $1`, [userId]);
    await client.query(`UPDATE withdrawals SET account_name = '(dihapus)', account_number = RIGHT(account_number, 4) WHERE user_id = $1`, [userId]);

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

module.exports = {
  resetWithRecovery,
  adminResetPassword,
  regenerateRecovery, changePassword, logoutAll, deleteAccount };

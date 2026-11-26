const bcrypt = require('bcryptjs');
const db = require('../db');
const v = require('../lib/validate');
const wallet = require('./wallet');
const { getSettings } = require('./settings');
const { ApiError, badRequest, forbidden, notFound, unauthorized } = require('../lib/errors');

/** Bank & e-wallet yang didukung untuk pencairan (rupiah). */
const PROVIDERS = [
  ...['BCA', 'BRI', 'BNI', 'Mandiri', 'BSI', 'CIMB Niaga', 'Permata', 'Danamon', 'BTN'].map((name) => ({ kind: 'bank', name })),
  ...['GoPay', 'OVO', 'DANA', 'ShopeePay', 'LinkAja'].map((name) => ({ kind: 'ewallet', name })),
];
const COOLDOWN_HOURS = 24;

const mask = (n) => (n.length <= 4 ? n : `${'•'.repeat(n.length - 4)}${n.slice(-4)}`);

function mapWithdrawal(r, { full = false } = {}) {
  return {
    id: Number(r.id),
    diamonds: Number(r.diamonds),
    rateIdr: r.rate_idr,
    grossIdr: Number(r.gross_idr),
    feeIdr: Number(r.fee_idr),
    netIdr: Number(r.net_idr),
    kind: r.kind,
    provider: r.provider,
    accountNumber: full ? r.account_number : mask(r.account_number),
    accountName: r.account_name,
    status: r.status,
    adminNote: r.admin_note,
    transferRef: r.transfer_ref,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  };
}

/** Hitung jumlah rupiah dari diamond sesuai pengaturan. */
function quote(diamonds, settings) {
  const rate = Number(settings.withdraw_rate_idr);
  const feePercent = Number(settings.withdraw_fee_percent);
  const gross = diamonds * rate;
  const fee = Math.floor((gross * feePercent) / 100);
  return { rate, gross, fee, net: gross - fee };
}

async function requireApprovedHost(client, userId) {
  const { rows } = await client.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u || u.status !== 'active') throw notFound('Akun tidak ditemukan');
  if (u.role !== 'host' || u.host_status !== 'approved') throw forbidden('Hanya host yang sudah disetujui yang bisa menarik diamond');
  return u;
}

async function checkPassword(user, password) {
  const given = v.str(password, 'Password', { max: 100 });
  if (!(await bcrypt.compare(given, user.password_hash))) throw unauthorized('Password salah', 'INVALID_CREDENTIALS');
}

/** Info untuk layar Tarik diamond. */
async function options(userId) {
  const user = await requireApprovedHost(db, userId);
  const settings = await getSettings();
  const { rows: acc } = await db.query(`SELECT * FROM payout_accounts WHERE user_id = $1`, [userId]);
  const { rows: pend } = await db.query(`SELECT * FROM withdrawals WHERE user_id = $1 AND status = 'pending'`, [userId]);
  const a = acc[0];
  return {
    diamonds: Number(user.diamonds),
    rateIdr: Number(settings.withdraw_rate_idr),
    minDiamonds: Number(settings.withdraw_min_diamonds),
    feePercent: Number(settings.withdraw_fee_percent),
    passwordSet: user.password_set !== false,
    cooldownHours: COOLDOWN_HOURS,
    providers: PROVIDERS,
    account: a
      ? {
          kind: a.kind,
          provider: a.provider,
          accountNumber: mask(a.account_number),
          accountName: a.account_name,
          cooldownUntil: a.cooldown_until && new Date(a.cooldown_until) > new Date() ? a.cooldown_until : null,
        }
      : null,
    pending: pend[0] ? mapWithdrawal(pend[0]) : null,
  };
}

/** Simpan/ubah rekening penarikan. Wajib password; mengubah rekening yang sudah ada menahan penarikan 24 jam. */
async function saveAccount(userId, body) {
  const user = await requireApprovedHost(db, userId);
  if (user.password_set === false) {
    throw new ApiError(403, 'PASSWORD_REQUIRED', 'Atur password dulu di Pengaturan akun sebelum menambahkan rekening penarikan.');
  }
  await checkPassword(user, body.password);

  const providerName = v.str(body.provider, 'Bank / e-wallet', { max: 30 });
  const provider = PROVIDERS.find((p) => p.name === providerName);
  if (!provider) throw badRequest('Bank atau e-wallet tidak didukung');
  const accountNumber = v.str(String(body.accountNumber ?? '').replace(/[\s-]/g, ''), 'Nomor rekening', { min: 5, max: 20, pattern: /^\d+$/ });
  const accountName = v.str(body.accountName, 'Nama pemilik rekening', { min: 3, max: 80, pattern: /^[\p{L}\s.'-]+$/u });

  const { rows: existing } = await db.query(`SELECT * FROM payout_accounts WHERE user_id = $1`, [userId]);
  const changed = existing[0] && (existing[0].provider !== provider.name || existing[0].account_number !== accountNumber);
  const { rows } = await db.query(
    `INSERT INTO payout_accounts (user_id, kind, provider, account_number, account_name, cooldown_until, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, now())
     ON CONFLICT (user_id) DO UPDATE SET
       kind = EXCLUDED.kind, provider = EXCLUDED.provider, account_number = EXCLUDED.account_number,
       account_name = EXCLUDED.account_name, updated_at = now(),
       cooldown_until = CASE WHEN $6::boolean THEN now() + make_interval(hours => $7) ELSE payout_accounts.cooldown_until END
     RETURNING cooldown_until`,
    [userId, provider.kind, provider.name, accountNumber, accountName, !!changed, COOLDOWN_HOURS]
  );
  return { cooldownUntil: rows[0].cooldown_until };
}

/** Ajukan penarikan: diamond langsung dipotong (ditahan) sampai admin membayar atau menolak. */
async function request(userId, body) {
  const diamonds = v.int(body.diamonds, 'Jumlah diamond', { min: 1, max: 1e9 });
  return db.tx(async (client) => {
    const { rows } = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const user = rows[0];
    if (!user || user.status !== 'active') throw notFound('Akun tidak ditemukan');
    if (user.role !== 'host' || user.host_status !== 'approved') throw forbidden('Hanya host yang sudah disetujui yang bisa menarik diamond');
    if (user.password_set === false) {
      throw new ApiError(403, 'PASSWORD_REQUIRED', 'Atur password dulu di Pengaturan akun sebelum menarik diamond.');
    }

    const settings = await getSettings(client);
    const min = Number(settings.withdraw_min_diamonds);
    if (diamonds < min) throw badRequest(`Penarikan minimal ${min.toLocaleString('id-ID')} diamond`, 'BELOW_MINIMUM');

    const { rows: acc } = await client.query(`SELECT * FROM payout_accounts WHERE user_id = $1`, [userId]);
    const a = acc[0];
    if (!a) throw new ApiError(400, 'NO_PAYOUT_ACCOUNT', 'Tambahkan rekening penarikan dulu.');
    if (a.cooldown_until && new Date(a.cooldown_until) > new Date()) {
      throw new ApiError(403, 'PAYOUT_COOLDOWN', `Rekening baru diubah. Demi keamanan, penarikan bisa diajukan setelah ${COOLDOWN_HOURS} jam.`, { until: a.cooldown_until });
    }
    const { rows: pend } = await client.query(`SELECT 1 FROM withdrawals WHERE user_id = $1 AND status = 'pending'`, [userId]);
    if (pend.length) throw new ApiError(409, 'PENDING_EXISTS', 'Masih ada penarikan yang sedang diproses.');

    const q = quote(diamonds, settings);
    const { rows: ins } = await client.query(
      `INSERT INTO withdrawals (user_id, diamonds, rate_idr, gross_idr, fee_idr, net_idr, kind, provider, account_number, account_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [userId, diamonds, q.rate, q.gross, q.fee, q.net, a.kind, a.provider, a.account_number, a.account_name]
    );
    // Potong diamond (gagal jika tidak cukup)
    try {
      await wallet.debitDiamonds(client, userId, diamonds, 'withdraw_hold', { type: 'withdrawal', id: Number(ins[0].id), note: 'Penarikan diamond' });
    } catch (e) {
      if (e.code === 'INSUFFICIENT_COINS') throw new ApiError(402, 'INSUFFICIENT_DIAMONDS', 'Diamond tidak cukup');
      throw e;
    }
    return mapWithdrawal(ins[0]);
  });
}

async function listMine(userId) {
  const { rows } = await db.query(`SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY id DESC LIMIT 30`, [userId]);
  return rows.map((r) => mapWithdrawal(r));
}

// Kembalikan diamond yang ditahan lalu ubah status (dipakai batal & tolak)
async function releaseHold(client, row, status, fields) {
  await wallet.creditDiamonds(client, Number(row.user_id), Number(row.diamonds), 'withdraw_refund', {
    type: 'withdrawal',
    id: Number(row.id),
    note: status === 'cancelled' ? 'Penarikan dibatalkan' : 'Penarikan ditolak',
  });
  const { rows } = await client.query(
    `UPDATE withdrawals SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [row.id, status, fields.note ?? null, fields.adminId ?? null]
  );
  return rows[0];
}

/** Host membatalkan pengajuannya sendiri selama belum diproses. */
async function cancel(userId, idRaw) {
  const id = v.id(idRaw);
  return db.tx(async (client) => {
    const { rows } = await client.query(`SELECT * FROM withdrawals WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId]);
    if (!rows.length) throw notFound('Penarikan tidak ditemukan');
    if (rows[0].status !== 'pending') throw new ApiError(409, 'NOT_PENDING', 'Penarikan ini sudah diproses.');
    return mapWithdrawal(await releaseHold(client, rows[0], 'cancelled', {}));
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function adminList(status) {
  const { rows } = await db.query(
    `SELECT w.*, u.display_name, u.username, u.avatar_url,
            (SELECT COALESCE(SUM(net_idr), 0) FROM withdrawals x WHERE x.user_id = w.user_id AND x.status = 'paid') AS paid_before
     FROM withdrawals w JOIN users u ON u.id = w.user_id
     WHERE w.status = $1 ORDER BY w.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
    [status]
  );
  return rows.map((r) => ({
    ...mapWithdrawal(r, { full: true }),
    user: { id: Number(r.user_id), displayName: r.display_name, username: r.username, avatarUrl: r.avatar_url },
    paidBeforeIdr: Number(r.paid_before),
  }));
}

async function adminPay(adminId, idRaw, { ref, note }) {
  const id = v.id(idRaw);
  const transferRef = v.str(ref, 'Nomor referensi transfer', { max: 80, optional: true }) ?? null;
  const adminNote = v.str(note, 'Catatan', { max: 300, optional: true }) ?? null;
  return db.tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE withdrawals SET status = 'paid', transfer_ref = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, transferRef, adminNote, adminId]
    );
    if (!rows.length) throw notFound('Penarikan tidak ditemukan atau sudah diproses');
    return rows[0];
  });
}

async function adminReject(adminId, idRaw, { reason }) {
  const id = v.id(idRaw);
  const note = v.str(reason, 'Alasan', { min: 3, max: 300 });
  return db.tx(async (client) => {
    const { rows } = await client.query(`SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length || rows[0].status !== 'pending') throw notFound('Penarikan tidak ditemukan atau sudah diproses');
    return releaseHold(client, rows[0], 'rejected', { note, adminId });
  });
}

module.exports = {
  PROVIDERS,
  mapWithdrawal,
  quote,
  options,
  saveAccount,
  request,
  listMine,
  cancel,
  adminList,
  adminPay,
  adminReject,
};

const bcrypt = require('bcryptjs');
const db = require('../db');
const v = require('../lib/validate');
const wallet = require('./wallet');
const { getSettings } = require('./settings');
const { isTronAddress } = require('../lib/tron');
const { ApiError, badRequest, forbidden, notFound, unauthorized } = require('../lib/errors');

/**
 * Metode penarikan mengikuti negara di profil host:
 *   Indonesia (ID)  -> bank / e-wallet, dibayar dalam Rupiah
 *   negara lain     -> USDT jaringan TRC20, dibayar dalam USD
 */
const BANKS = ['BCA', 'BRI', 'BNI', 'Mandiri', 'BSI', 'CIMB Niaga', 'Permata', 'Danamon', 'BTN'];
const EWALLETS = ['GoPay', 'OVO', 'DANA', 'ShopeePay', 'LinkAja'];
const IDR_PROVIDERS = [...BANKS.map((name) => ({ kind: 'bank', name })), ...EWALLETS.map((name) => ({ kind: 'ewallet', name }))];
const USDT = { kind: 'crypto', name: 'USDT (TRC20)' };
const COOLDOWN_HOURS = 24;

const methodFor = (countryCode) => (String(countryCode || '').trim().toUpperCase() === 'ID' ? 'idr' : 'usdt');
const providersFor = (method) => (method === 'idr' ? IDR_PROVIDERS : [USDT]);

const mask = (n) => (n.length <= 4 ? n : `${'•'.repeat(Math.min(8, n.length - 4))}${n.slice(-4)}`);

function mapWithdrawal(r, { full = false } = {}) {
  return {
    id: Number(r.id),
    diamonds: Number(r.diamonds),
    currency: r.currency,
    diamondsPerUsd: r.diamonds_per_usd,
    usdIdr: r.usd_idr,
    // satuan terkecil: Rupiah utuh (IDR) atau sen (USD)
    gross: Number(r.gross),
    fee: Number(r.fee),
    net: Number(r.net),
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

/**
 * Hitung nilai penarikan.
 *   IDR: diamond / koin-per-USD * kurs rupiah, dikurangi biaya %
 *   USD: diamond / koin-per-USD (dalam sen), dikurangi biaya % dan biaya jaringan USDT tetap
 */
function quote(diamonds, method, settings) {
  const perUsd = Number(settings.withdraw_diamonds_per_usd);
  const usdIdr = Number(settings.withdraw_usd_idr);
  const feePercent = Number(settings.withdraw_fee_percent);
  if (method === 'idr') {
    const gross = Math.floor((diamonds * usdIdr) / perUsd);
    const fee = Math.floor((gross * feePercent) / 100);
    return { currency: 'IDR', perUsd, usdIdr, gross, fee, net: gross - fee };
  }
  const gross = Math.floor((diamonds * 100) / perUsd);
  const fee = Math.floor((gross * feePercent) / 100) + Math.round(Number(settings.withdraw_usdt_fee_usd) * 100);
  return { currency: 'USD', perUsd, usdIdr, gross, fee, net: gross - fee };
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
  const method = methodFor(user.country_code);
  const { rows: acc } = await db.query(`SELECT * FROM payout_accounts WHERE user_id = $1`, [userId]);
  const { rows: pend } = await db.query(`SELECT * FROM withdrawals WHERE user_id = $1 AND status = 'pending'`, [userId]);
  const allowed = providersFor(method).map((p) => p.kind);
  // Rekening lama yang tidak cocok dengan metode negara sekarang dianggap belum ada
  const a = acc[0] && allowed.includes(acc[0].kind) ? acc[0] : null;
  return {
    diamonds: Number(user.diamonds),
    method,
    currency: method === 'idr' ? 'IDR' : 'USD',
    countryCode: user.country_code ? user.country_code.trim() : null,
    diamondsPerUsd: Number(settings.withdraw_diamonds_per_usd),
    usdIdr: Number(settings.withdraw_usd_idr),
    minDiamonds: Number(settings.withdraw_min_diamonds),
    feePercent: Number(settings.withdraw_fee_percent),
    usdtFeeUsd: Number(settings.withdraw_usdt_fee_usd),
    passwordSet: user.password_set !== false,
    cooldownHours: COOLDOWN_HOURS,
    providers: providersFor(method),
    account: a
      ? {
          kind: a.kind,
          provider: a.provider,
          accountNumber: a.kind === 'crypto' ? `${a.account_number.slice(0, 4)}…${a.account_number.slice(-4)}` : mask(a.account_number),
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

  const method = methodFor(user.country_code);
  const providerName = v.str(body.provider, 'Metode penarikan', { max: 30 });
  const provider = providersFor(method).find((p) => p.name === providerName);
  if (!provider) throw badRequest(method === 'idr' ? 'Bank atau e-wallet tidak didukung' : 'Metode penarikan untuk negaramu adalah USDT (TRC20)');

  let accountNumber;
  let accountName = null;
  if (provider.kind === 'crypto') {
    accountNumber = v.str(String(body.accountNumber ?? '').trim(), 'Alamat dompet USDT', { min: 34, max: 34 });
    if (!isTronAddress(accountNumber)) {
      throw badRequest('Alamat tidak valid. Gunakan alamat jaringan TRC20 (Tron) yang diawali huruf T dan periksa lagi per huruf.', 'INVALID_ADDRESS');
    }
  } else {
    accountNumber = v.str(String(body.accountNumber ?? '').replace(/[\s-]/g, ''), 'Nomor rekening', { min: 5, max: 20, pattern: /^\d+$/ });
    accountName = v.str(body.accountName, 'Nama pemilik rekening', { min: 3, max: 80, pattern: /^[\p{L}\s.'-]+$/u });
  }

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

    const method = methodFor(user.country_code);
    const { rows: acc } = await client.query(`SELECT * FROM payout_accounts WHERE user_id = $1`, [userId]);
    const a = acc[0];
    if (!a || !providersFor(method).some((p) => p.kind === a.kind)) {
      throw new ApiError(400, 'NO_PAYOUT_ACCOUNT', method === 'idr' ? 'Tambahkan rekening penarikan dulu.' : 'Tambahkan alamat dompet USDT (TRC20) dulu.');
    }
    if (a.cooldown_until && new Date(a.cooldown_until) > new Date()) {
      throw new ApiError(403, 'PAYOUT_COOLDOWN', `Rekening baru diubah. Demi keamanan, penarikan bisa diajukan setelah ${COOLDOWN_HOURS} jam.`, { until: a.cooldown_until });
    }
    const { rows: pend } = await client.query(`SELECT 1 FROM withdrawals WHERE user_id = $1 AND status = 'pending'`, [userId]);
    if (pend.length) throw new ApiError(409, 'PENDING_EXISTS', 'Masih ada penarikan yang sedang diproses.');

    const q = quote(diamonds, method, settings);
    if (q.net <= 0) throw badRequest('Jumlah terlalu kecil setelah biaya penarikan', 'BELOW_MINIMUM');
    const { rows: ins } = await client.query(
      `INSERT INTO withdrawals (user_id, diamonds, currency, diamonds_per_usd, usd_idr, gross, fee, net, kind, provider, account_number, account_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [userId, diamonds, q.currency, q.perUsd, q.usdIdr, q.gross, q.fee, q.net, a.kind, a.provider, a.account_number, a.account_name]
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
    `SELECT w.*, u.display_name, u.username, u.avatar_url, u.country_code,
            (SELECT COALESCE(SUM(x.net), 0) FROM withdrawals x WHERE x.user_id = w.user_id AND x.status = 'paid' AND x.currency = w.currency) AS paid_before
     FROM withdrawals w JOIN users u ON u.id = w.user_id
     WHERE w.status = $1 ORDER BY w.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
    [status]
  );
  return rows.map((r) => ({
    ...mapWithdrawal(r, { full: true }),
    user: { id: Number(r.user_id), displayName: r.display_name, username: r.username, avatarUrl: r.avatar_url, countryCode: r.country_code ? r.country_code.trim() : null },
    paidBefore: Number(r.paid_before),
  }));
}

async function adminPay(adminId, idRaw, { ref, note }) {
  const id = v.id(idRaw);
  const transferRef = v.str(ref, 'Nomor referensi / hash transaksi', { max: 120, optional: true }) ?? null;
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
  methodFor,
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

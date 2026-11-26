const bcrypt = require('bcryptjs');
const db = require('../db');
const v = require('../lib/validate');
const { getSettings } = require('./settings');
const { isTronAddress } = require('../lib/tron');
const { signAgencyToken } = require('../lib/tokens');
const { ApiError, badRequest, notFound, unauthorized } = require('../lib/errors');
const withdraw = require('./withdraw');

/**
 * Panel agency: login, ringkasan penghasilan, daftar host, dan penarikan komisi.
 * Komisi agency dihitung di wallet.payHost (persen dari penghasilan host) dan masuk ke agencies.balance (diamond).
 * Penarikan memakai kurs & aturan yang sama dengan host; metode mengikuti agencies.country_code.
 */
const { providersFor, mask, methodFor, quote, COOLDOWN_HOURS } = withdraw;

function mapAgencyWithdrawal(r, { full = false } = {}) {
  return withdraw.mapWithdrawal(r, { full });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function login(usernameRaw, passwordRaw) {
  const username = v.str(usernameRaw, 'Username', { max: 40 }).toLowerCase();
  const password = v.str(passwordRaw, 'Password', { max: 100 });
  const { rows } = await db.query(`SELECT * FROM agencies WHERE lower(username) = $1`, [username]);
  const a = rows[0];
  // Pesan sama untuk semua kegagalan supaya username tidak bisa ditebak
  const fail = () => unauthorized('Username atau password salah', 'INVALID_CREDENTIALS');
  if (!a || !a.password_hash || !(await bcrypt.compare(password, a.password_hash))) throw fail();
  if (!a.active) throw new ApiError(403, 'AGENCY_DISABLED', 'Agency ini dinonaktifkan. Hubungi admin.');
  return { accessToken: signAgencyToken(a), agency: { id: Number(a.id), name: a.name, username: a.username } };
}

async function changePassword(agencyId, body) {
  const { rows } = await db.query(`SELECT * FROM agencies WHERE id = $1`, [agencyId]);
  const a = rows[0];
  if (!a) throw notFound('Agency tidak ditemukan');
  if (!(await bcrypt.compare(v.str(body.currentPassword, 'Password lama', { max: 100 }), a.password_hash))) {
    throw unauthorized('Password lama salah', 'INVALID_CREDENTIALS');
  }
  const next = v.str(body.newPassword, 'Password baru', { min: 8, max: 100 });
  if (next === body.currentPassword) throw badRequest('Password baru harus berbeda');
  await db.query(`UPDATE agencies SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [agencyId, await bcrypt.hash(next, 10)]);
  // Token baru supaya sesi ini tetap berjalan (token lama otomatis tidak berlaku)
  return { accessToken: signAgencyToken(a) };
}

// ---------------------------------------------------------------------------
// Ringkasan, host, riwayat
// ---------------------------------------------------------------------------

async function overview(agencyId) {
  const { rows } = await db.query(`SELECT * FROM agencies WHERE id = $1`, [agencyId]);
  const a = rows[0];
  const settings = await getSettings();
  const method = methodFor(a.country_code);
  const balance = Number(a.balance);
  const q = balance > 0 ? quote(balance, method, settings) : null;
  const { rows: st } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE agency_id = $1)::int AS hosts,
       (SELECT COUNT(*) FROM users WHERE agency_id = $1 AND host_status = 'approved')::int AS hosts_approved,
       (SELECT COALESCE(SUM(amount), 0) FROM agency_earnings WHERE agency_id = $1 AND created_at > now() - interval '24 hours')::bigint AS d1,
       (SELECT COALESCE(SUM(amount), 0) FROM agency_earnings WHERE agency_id = $1 AND created_at > now() - interval '7 days')::bigint AS d7,
       (SELECT COALESCE(SUM(amount), 0) FROM agency_earnings WHERE agency_id = $1 AND created_at > now() - interval '30 days')::bigint AS d30,
       (SELECT COALESCE(SUM(net), 0) FROM agency_withdrawals WHERE agency_id = $1 AND status = 'paid' AND currency = 'IDR')::bigint AS paid_idr,
       (SELECT COALESCE(SUM(net), 0) FROM agency_withdrawals WHERE agency_id = $1 AND status = 'paid' AND currency = 'USD')::bigint AS paid_usd`,
    [agencyId]
  );
  const x = st[0];
  return {
    agency: {
      id: Number(a.id),
      name: a.name,
      code: a.code,
      username: a.username,
      commissionRate: Number(a.commission_rate),
      countryCode: a.country_code ? a.country_code.trim() : null,
    },
    balance,
    earningsTotal: Number(a.earnings_total),
    last24h: Number(x.d1),
    last7d: Number(x.d7),
    last30d: Number(x.d30),
    hosts: x.hosts,
    hostsApproved: x.hosts_approved,
    paidIdr: Number(x.paid_idr),
    paidUsdCents: Number(x.paid_usd),
    // nilai balance saat ini dalam uang (satuan terkecil: Rupiah / sen USD) sebelum biaya
    estimate: q ? { currency: q.currency, gross: q.gross, fee: q.fee, net: q.net } : null,
    method,
    currency: method === 'idr' ? 'IDR' : 'USD',
    minDiamonds: Number(settings.withdraw_min_diamonds),
  };
}

async function hosts(agencyId) {
  const { rows } = await db.query(
    `SELECT u.id, u.display_name, u.avatar_url, u.host_status, u.verified, u.last_seen_at, u.country_code, u.created_at,
            COALESCE((SELECT SUM(e.amount) FROM agency_earnings e WHERE e.agency_id = $1 AND e.host_id = u.id), 0) AS earned,
            COALESCE((SELECT SUM(e.amount) FROM agency_earnings e WHERE e.agency_id = $1 AND e.host_id = u.id AND e.created_at > now() - interval '7 days'), 0) AS earned7
     FROM users u WHERE u.agency_id = $1 ORDER BY earned DESC, u.id`,
    [agencyId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    status: r.host_status,
    verified: !!r.verified,
    countryCode: r.country_code ? r.country_code.trim() : null,
    lastSeenAt: r.last_seen_at,
    joinedAt: r.created_at,
    earned: Number(r.earned),
    earned7d: Number(r.earned7),
  }));
}

async function earnings(agencyId) {
  const { rows } = await db.query(
    `SELECT e.id, e.amount, e.source, e.created_at, u.id AS host_id, u.display_name
     FROM agency_earnings e JOIN users u ON u.id = e.host_id
     WHERE e.agency_id = $1 ORDER BY e.id DESC LIMIT 100`,
    [agencyId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    amount: Number(r.amount),
    source: r.source,
    createdAt: r.created_at,
    host: { id: Number(r.host_id), displayName: r.display_name },
  }));
}

// ---------------------------------------------------------------------------
// Penarikan
// ---------------------------------------------------------------------------

async function loadAgency(client, agencyId, lock = false) {
  const { rows } = await client.query(`SELECT * FROM agencies WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [agencyId]);
  if (!rows.length || !rows[0].active) throw notFound('Agency tidak ditemukan');
  return rows[0];
}

async function checkPassword(agency, password) {
  const given = v.str(password, 'Password', { max: 100 });
  if (!agency.password_hash || !(await bcrypt.compare(given, agency.password_hash))) throw unauthorized('Password salah', 'INVALID_CREDENTIALS');
}

async function withdrawOptions(agencyId) {
  const a = await loadAgency(db, agencyId);
  const settings = await getSettings();
  const method = methodFor(a.country_code);
  const { rows: acc } = await db.query(`SELECT * FROM agency_payout_accounts WHERE agency_id = $1`, [agencyId]);
  const { rows: pend } = await db.query(`SELECT * FROM agency_withdrawals WHERE agency_id = $1 AND status = 'pending'`, [agencyId]);
  const allowed = providersFor(method).map((p) => p.kind);
  const acct = acc[0] && allowed.includes(acc[0].kind) ? acc[0] : null;
  return {
    balance: Number(a.balance),
    method,
    currency: method === 'idr' ? 'IDR' : 'USD',
    countryCode: a.country_code ? a.country_code.trim() : null,
    diamondsPerUsd: Number(settings.withdraw_diamonds_per_usd),
    usdIdr: Number(settings.withdraw_usd_idr),
    minDiamonds: Number(settings.withdraw_min_diamonds),
    feePercent: Number(settings.withdraw_fee_percent),
    usdtFeeUsd: Number(settings.withdraw_usdt_fee_usd),
    cooldownHours: COOLDOWN_HOURS,
    providers: providersFor(method),
    account: acct
      ? {
          kind: acct.kind,
          provider: acct.provider,
          accountNumber: acct.kind === 'crypto' ? `${acct.account_number.slice(0, 4)}…${acct.account_number.slice(-4)}` : mask(acct.account_number),
          accountName: acct.account_name,
          cooldownUntil: acct.cooldown_until && new Date(acct.cooldown_until) > new Date() ? acct.cooldown_until : null,
        }
      : null,
    pending: pend[0] ? mapAgencyWithdrawal(pend[0]) : null,
  };
}

async function saveAccount(agencyId, body) {
  const a = await loadAgency(db, agencyId);
  await checkPassword(a, body.password);
  const method = methodFor(a.country_code);
  const providerName = v.str(body.provider, 'Metode penarikan', { max: 30 });
  const provider = providersFor(method).find((p) => p.name === providerName);
  if (!provider) throw badRequest(method === 'idr' ? 'Bank atau e-wallet tidak didukung' : 'Metode penarikan untuk negara agency adalah USDT (TRC20)');

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

  const { rows: existing } = await db.query(`SELECT * FROM agency_payout_accounts WHERE agency_id = $1`, [agencyId]);
  const changed = existing[0] && (existing[0].provider !== provider.name || existing[0].account_number !== accountNumber);
  const { rows } = await db.query(
    `INSERT INTO agency_payout_accounts (agency_id, kind, provider, account_number, account_name, cooldown_until, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, now())
     ON CONFLICT (agency_id) DO UPDATE SET
       kind = EXCLUDED.kind, provider = EXCLUDED.provider, account_number = EXCLUDED.account_number,
       account_name = EXCLUDED.account_name, updated_at = now(),
       cooldown_until = CASE WHEN $6::boolean THEN now() + make_interval(hours => $7) ELSE agency_payout_accounts.cooldown_until END
     RETURNING cooldown_until`,
    [agencyId, provider.kind, provider.name, accountNumber, accountName, !!changed, COOLDOWN_HOURS]
  );
  return { cooldownUntil: rows[0].cooldown_until };
}

/** Ajukan penarikan: saldo langsung dipotong (ditahan) sampai admin membayar atau menolak. */
async function requestWithdrawal(agencyId, body) {
  const diamonds = v.int(body.diamonds, 'Jumlah diamond', { min: 1, max: 1e12 });
  return db.tx(async (client) => {
    const a = await loadAgency(client, agencyId, true);
    await checkPassword(a, body.password);
    const settings = await getSettings(client);
    const min = Number(settings.withdraw_min_diamonds);
    if (diamonds < min) throw badRequest(`Penarikan minimal ${min.toLocaleString('id-ID')} diamond`, 'BELOW_MINIMUM');

    const method = methodFor(a.country_code);
    const { rows: acc } = await client.query(`SELECT * FROM agency_payout_accounts WHERE agency_id = $1`, [agencyId]);
    const acct = acc[0];
    if (!acct || !providersFor(method).some((p) => p.kind === acct.kind)) {
      throw new ApiError(400, 'NO_PAYOUT_ACCOUNT', method === 'idr' ? 'Tambahkan rekening penarikan dulu.' : 'Tambahkan alamat dompet USDT (TRC20) dulu.');
    }
    if (acct.cooldown_until && new Date(acct.cooldown_until) > new Date()) {
      throw new ApiError(403, 'PAYOUT_COOLDOWN', `Rekening baru diubah. Demi keamanan, penarikan bisa diajukan setelah ${COOLDOWN_HOURS} jam.`, { until: acct.cooldown_until });
    }
    const { rows: pend } = await client.query(`SELECT 1 FROM agency_withdrawals WHERE agency_id = $1 AND status = 'pending'`, [agencyId]);
    if (pend.length) throw new ApiError(409, 'PENDING_EXISTS', 'Masih ada penarikan yang sedang diproses.');
    if (Number(a.balance) < diamonds) throw new ApiError(402, 'INSUFFICIENT_DIAMONDS', 'Saldo komisi tidak cukup');

    const q = quote(diamonds, method, settings);
    if (q.net <= 0) throw badRequest('Jumlah terlalu kecil setelah biaya penarikan', 'BELOW_MINIMUM');
    const { rows: ins } = await client.query(
      `INSERT INTO agency_withdrawals (agency_id, diamonds, currency, diamonds_per_usd, usd_idr, gross, fee, net, kind, provider, account_number, account_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [agencyId, diamonds, q.currency, q.perUsd, q.usdIdr, q.gross, q.fee, q.net, acct.kind, acct.provider, acct.account_number, acct.account_name]
    );
    await client.query(`UPDATE agencies SET balance = balance - $2 WHERE id = $1`, [agencyId, diamonds]);
    return mapAgencyWithdrawal(ins[0]);
  });
}

async function listWithdrawals(agencyId) {
  const { rows } = await db.query(`SELECT * FROM agency_withdrawals WHERE agency_id = $1 ORDER BY id DESC LIMIT 30`, [agencyId]);
  return rows.map((r) => mapAgencyWithdrawal(r));
}

async function releaseHold(client, row, status, { note, adminId }) {
  await client.query(`UPDATE agencies SET balance = balance + $2 WHERE id = $1`, [row.agency_id, row.diamonds]);
  const { rows } = await client.query(
    `UPDATE agency_withdrawals SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [row.id, status, note ?? null, adminId ?? null]
  );
  return rows[0];
}

async function cancelWithdrawal(agencyId, idRaw) {
  const id = v.id(idRaw);
  return db.tx(async (client) => {
    await loadAgency(client, agencyId, true);
    const { rows } = await client.query(`SELECT * FROM agency_withdrawals WHERE id = $1 AND agency_id = $2 FOR UPDATE`, [id, agencyId]);
    if (!rows.length) throw notFound('Penarikan tidak ditemukan');
    if (rows[0].status !== 'pending') throw new ApiError(409, 'NOT_PENDING', 'Penarikan ini sudah diproses.');
    return mapAgencyWithdrawal(await releaseHold(client, rows[0], 'cancelled', {}));
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function adminList(status) {
  const { rows } = await db.query(
    `SELECT w.*, a.name, a.code, a.country_code,
            (SELECT COALESCE(SUM(x.net), 0) FROM agency_withdrawals x WHERE x.agency_id = w.agency_id AND x.status = 'paid' AND x.currency = w.currency) AS paid_before
     FROM agency_withdrawals w JOIN agencies a ON a.id = w.agency_id
     WHERE w.status = $1 ORDER BY w.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
    [status]
  );
  return rows.map((r) => ({
    ...mapAgencyWithdrawal(r, { full: true }),
    owner: 'agency',
    // bentuk sama dengan penarikan host supaya daftar admin bisa dipakai bersama
    user: { id: Number(r.agency_id), displayName: `${r.name} (agency)`, username: r.code, avatarUrl: null, countryCode: r.country_code ? r.country_code.trim() : null },
    paidBefore: Number(r.paid_before),
  }));
}

async function adminPay(adminId, idRaw, { ref, note }) {
  const id = v.id(idRaw);
  const transferRef = v.str(ref, 'Nomor referensi / hash transaksi', { max: 120, optional: true }) ?? null;
  const adminNote = v.str(note, 'Catatan', { max: 300, optional: true }) ?? null;
  const { rows } = await db.query(
    `UPDATE agency_withdrawals SET status = 'paid', transfer_ref = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, transferRef, adminNote, adminId]
  );
  if (!rows.length) throw notFound('Penarikan tidak ditemukan atau sudah diproses');
  return rows[0];
}

async function adminReject(adminId, idRaw, { reason }) {
  const id = v.id(idRaw);
  const note = v.str(reason, 'Alasan', { min: 3, max: 300 });
  return db.tx(async (client) => {
    const { rows } = await client.query(`SELECT * FROM agency_withdrawals WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length || rows[0].status !== 'pending') throw notFound('Penarikan tidak ditemukan atau sudah diproses');
    await client.query(`SELECT id FROM agencies WHERE id = $1 FOR UPDATE`, [rows[0].agency_id]);
    return releaseHold(client, rows[0], 'rejected', { note, adminId });
  });
}

/** Admin mengatur login agency: username, password awal, dan negara (menentukan metode penarikan). */
async function adminSetLogin(agencyIdRaw, body) {
  const id = v.id(agencyIdRaw);
  const username = v.str(body.username, 'Username', { min: 4, max: 40, pattern: /^[a-zA-Z0-9._-]+$/ });
  const password = body.password === undefined || body.password === '' ? null : v.str(body.password, 'Password', { min: 8, max: 100 });
  const country = body.countryCode === undefined ? null : v.str(body.countryCode, 'Negara', { pattern: /^[A-Za-z]{2}$/ }).toUpperCase();
  const { rows } = await db.query(`SELECT * FROM agencies WHERE id = $1`, [id]);
  if (!rows.length) throw notFound('Agency tidak ditemukan');
  if (!rows[0].password_hash && !password) throw badRequest('Password awal wajib diisi');
  try {
    await db.query(
      `UPDATE agencies SET username = $2,
         password_hash = COALESCE($3, password_hash),
         password_changed_at = CASE WHEN $3::text IS NULL THEN password_changed_at ELSE now() END,
         country_code = COALESCE($4, country_code)
       WHERE id = $1`,
      [id, username, password ? await bcrypt.hash(password, 10) : null, country]
    );
  } catch (e) {
    if (e.code === '23505') throw badRequest('Username sudah dipakai agency lain', 'USERNAME_TAKEN');
    throw e;
  }
}

module.exports = {
  login,
  changePassword,
  overview,
  hosts,
  earnings,
  withdrawOptions,
  saveAccount,
  requestWithdrawal,
  listWithdrawals,
  cancelWithdrawal,
  adminList,
  adminPay,
  adminReject,
  adminSetLogin,
};

/**
 * Panel agency: login terpisah, saldo komisi, penarikan, pembayaran oleh admin.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');

let server;
let base;
let admin;
let agency;
let host;
let buyer;
let giftId;
let ag; // token agency

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const A = (method, p, body) => api(method, p, { token: admin, body });
const G = (method, p, body) => api(method, p, { token: ag, body });
const register = async (name) => {
  const r = await api('POST', '/api/auth/register', { body: { username: name, password: 'rahasia123', displayName: name } });
  return { id: r.body.user.id, token: r.body.accessToken };
};
const TRON = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'; // alamat Tron valid (checksum benar)

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  const hash = await bcrypt.hash('admin123', 4);
  await db.query(`INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', $1, 'Admin', 'admin')`, [hash]);
  server = http.createServer(createApp());
  realtime.attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } })).body.accessToken;

  agency = (await A('POST', '/api/admin/agencies', { name: 'Agency Uji', commissionRate: 0.1 })).body;
  host = await register('hostagency');
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved', profile_completed = true, agency_id = $2 WHERE id = $1`, [host.id, agency.id]);
  await db.query(`INSERT INTO host_profiles (user_id, chat_price) VALUES ($1, 100) ON CONFLICT (user_id) DO UPDATE SET chat_price = 100`, [host.id]);
  buyer = await register('pembeliagency');
  await A('POST', `/api/admin/users/${buyer.id}/coins`, { amount: 50000 });
  giftId = (await db.query(`INSERT INTO gifts (name, price) VALUES ('Mawar', 1000) RETURNING id`)).rows[0].id;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('admin mengatur login agency; username unik, password min 8, wajib password awal', async () => {
  assert.equal((await A('PUT', `/api/admin/agencies/${agency.id}/login`, { username: 'abc' })).status, 400, 'username min 4');
  assert.equal((await A('PUT', `/api/admin/agencies/${agency.id}/login`, { username: 'agen.uji' })).status, 400, 'password awal wajib');
  assert.equal((await A('PUT', `/api/admin/agencies/${agency.id}/login`, { username: 'agen.uji', password: 'pendek' })).status, 400);
  const ok = await A('PUT', `/api/admin/agencies/${agency.id}/login`, { username: 'agen.uji', password: 'rahasia-agen', countryCode: 'id' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const other = (await A('POST', '/api/admin/agencies', { name: 'Lain', commissionRate: 0.1 })).body;
  const dup = await A('PUT', `/api/admin/agencies/${other.id}/login`, { username: 'AGEN.uji', password: 'rahasia-lain' });
  assert.equal(dup.body.error.code, 'USERNAME_TAKEN');
  const list = (await A('GET', '/api/admin/agencies')).body.find((a) => a.id === agency.id);
  assert.equal(list.username, 'agen.uji');
  assert.equal(list.loginSet, true);
  assert.equal((await api('PUT', `/api/admin/agencies/${agency.id}/login`, { token: (await register('biasa')).token, body: { username: 'xxxx' } })).status, 403);
});

test('login agency: salah ditolak dengan pesan sama; token agency terpisah dari token pengguna/admin', async () => {
  const bad1 = await api('POST', '/api/agency/login', { body: { username: 'agen.uji', password: 'salah-salah' } });
  const bad2 = await api('POST', '/api/agency/login', { body: { username: 'tidakada', password: 'salah-salah' } });
  assert.equal(bad1.status, 401);
  assert.equal(bad1.body.error.message, bad2.body.error.message);
  const ok = await api('POST', '/api/agency/login', { body: { username: 'Agen.Uji', password: 'rahasia-agen' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  ag = ok.body.accessToken;
  assert.equal(ok.body.agency.name, 'Agency Uji');

  assert.equal((await G('GET', '/api/agency/overview')).status, 200);
  assert.equal((await api('GET', '/api/agency/overview')).status, 401, 'tanpa token');
  assert.equal((await api('GET', '/api/agency/overview', { token: admin })).status, 401, 'token admin tidak berlaku di panel agency');
  assert.equal((await api('GET', '/api/agency/overview', { token: host.token })).status, 401, 'token pengguna tidak berlaku');
  // token agency tidak bisa dipakai sebagai pengguna / admin (id agency bisa sama dengan id pengguna)
  assert.equal((await api('GET', '/api/me', { token: ag })).status, 401);
  assert.equal((await api('GET', '/api/admin/stats', { token: ag })).status, 401);
});

test('komisi masuk ke saldo agency: gift 1000 -> host 100, agency 10; ringkasan, host, riwayat', async () => {
  const before = (await G('GET', '/api/agency/overview')).body;
  assert.equal(before.balance, 0);
  const conv = (await api('POST', '/api/conversations', { token: buyer.token, body: { hostId: host.id } })).body;
  const g = await api('POST', `/api/conversations/${conv.id}/gifts`, { token: buyer.token, body: { giftId, count: 2 } });
  assert.equal(g.status, 201, JSON.stringify(g.body));

  const o = (await G('GET', '/api/agency/overview')).body;
  assert.equal(o.balance, 20, '2 gift x 100 diamond host x 10%');
  assert.equal(o.earningsTotal, 20);
  assert.equal(o.last24h, 20);
  assert.equal(o.hosts, 1);
  assert.equal(o.method, 'idr');
  assert.equal(o.agency.commissionRate, 0.1);

  const hosts = (await G('GET', '/api/agency/hosts')).body;
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].displayName, 'hostagency');
  assert.equal(hosts[0].earned, 20);
  const log = (await G('GET', '/api/agency/earnings')).body;
  assert.equal(log.length, 1);
  assert.equal(log[0].amount, 20);
  assert.equal(log[0].source, 'gift');
});

test('penarikan: rekening wajib + password, minimal, hanya satu menunggu, saldo ditahan, batal mengembalikan', async () => {
  await A('PATCH', '/api/admin/settings', { withdraw_min_diamonds: 5 });
  const noAcc = await G('POST', '/api/agency/withdraw', { diamonds: 10, password: 'rahasia-agen' });
  assert.equal(noAcc.body.error.code, 'NO_PAYOUT_ACCOUNT');

  const wrongPw = await G('PUT', '/api/agency/withdraw/account', { provider: 'BCA', accountNumber: '1234567890', accountName: 'Agency Uji', password: 'salah-salah' });
  assert.equal(wrongPw.status, 401);
  const crypto = await G('PUT', '/api/agency/withdraw/account', { provider: 'USDT (TRC20)', accountNumber: TRON, password: 'rahasia-agen' });
  assert.equal(crypto.status, 400, 'agency Indonesia memakai bank/e-wallet, bukan USDT');
  const acc = await G('PUT', '/api/agency/withdraw/account', { provider: 'BCA', accountNumber: '1234 5678 90', accountName: 'Agency Uji', password: 'rahasia-agen' });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));

  assert.equal((await G('POST', '/api/agency/withdraw', { diamonds: 3, password: 'rahasia-agen' })).body.error.code, 'BELOW_MINIMUM');
  assert.equal((await G('POST', '/api/agency/withdraw', { diamonds: 10, password: 'salah-salah' })).status, 401);
  assert.equal((await G('POST', '/api/agency/withdraw', { diamonds: 999, password: 'rahasia-agen' })).body.error.code, 'INSUFFICIENT_DIAMONDS');

  const w = await G('POST', '/api/agency/withdraw', { diamonds: 8, password: 'rahasia-agen' });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.equal(w.body.diamonds, 8);
  assert.equal(w.body.currency, 'IDR');
  assert.equal(w.body.gross, Math.floor((8 * 17000) / 6667));
  assert.equal(w.body.accountNumber.endsWith('7890'), true);
  assert.ok(!JSON.stringify(w.body).includes('1234567890'), 'nomor rekening disamarkan untuk agency');
  assert.equal((await G('GET', '/api/agency/overview')).body.balance, 12, 'saldo ditahan');
  assert.equal((await G('POST', '/api/agency/withdraw', { diamonds: 5, password: 'rahasia-agen' })).body.error.code, 'PENDING_EXISTS');

  const cancelled = await G('POST', `/api/agency/withdraw/${w.body.id}/cancel`);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await G('GET', '/api/agency/overview')).body.balance, 20, 'batal mengembalikan saldo');
});

test('admin melihat, membayar, dan menolak penarikan agency; saldo kembali saat ditolak', async () => {
  const w1 = (await G('POST', '/api/agency/withdraw', { diamonds: 10, password: 'rahasia-agen' })).body;
  const pend = (await A('GET', '/api/admin/withdrawals?status=pending')).body;
  const mine = pend.find((x) => x.owner === 'agency' && x.id === w1.id);
  assert.ok(mine, 'tampil di daftar penarikan admin');
  assert.equal(mine.accountNumber, '1234567890', 'admin melihat nomor lengkap');
  assert.equal(mine.user.displayName, 'Agency Uji (agency)');
  assert.equal((await A('GET', '/api/admin/stats')).body.pending.withdrawals >= 1, true);

  // ditolak: saldo kembali
  const rej = await A('POST', `/api/admin/agency-withdrawals/${w1.id}/reject`, { reason: 'nama rekening tidak cocok' });
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal((await G('GET', '/api/agency/overview')).body.balance, 20);
  assert.equal((await A('POST', `/api/admin/agency-withdrawals/${w1.id}/reject`, { reason: 'dua kali' })).status, 404, 'tidak bisa diproses dua kali');
  const hist = (await G('GET', '/api/agency/withdraw')).body;
  assert.equal(hist.find((x) => x.id === w1.id).status, 'rejected');
  assert.equal(hist.find((x) => x.id === w1.id).adminNote, 'nama rekening tidak cocok');

  // dibayar: saldo tetap berkurang
  const w2 = (await G('POST', '/api/agency/withdraw', { diamonds: 12, password: 'rahasia-agen' })).body;
  const pay = await A('POST', `/api/admin/agency-withdrawals/${w2.id}/pay`, { ref: 'TRX-1', note: 'ok' });
  assert.equal(pay.status, 200);
  const o = (await G('GET', '/api/agency/overview')).body;
  assert.equal(o.balance, 8);
  assert.equal(o.earningsTotal, 20, 'total seumur hidup tidak berkurang');
  assert.equal(o.paidIdr, w2.net);
  assert.equal((await A('POST', `/api/admin/agency-withdrawals/${w2.id}/pay`, {})).status, 404);
});

test('ganti rekening menahan penarikan 24 jam; ganti password mencabut sesi lama', async () => {
  const chg = await G('PUT', '/api/agency/withdraw/account', { provider: 'BRI', accountNumber: '9876543210', accountName: 'Agency Uji', password: 'rahasia-agen' });
  assert.equal(chg.status, 200);
  assert.ok(chg.body.cooldownUntil, 'cooldown aktif setelah rekening diganti');
  assert.equal((await G('POST', '/api/agency/withdraw', { diamonds: 6, password: 'rahasia-agen' })).body.error.code, 'PAYOUT_COOLDOWN');

  assert.equal((await G('POST', '/api/agency/password', { currentPassword: 'salah-salah', newPassword: 'passwordbaru1' })).status, 401);
  assert.equal((await G('POST', '/api/agency/password', { currentPassword: 'rahasia-agen', newPassword: 'pendek' })).status, 400);
  await new Promise((r) => setTimeout(r, 1200)); // token baru harus lebih baru dari waktu ganti password
  const old = ag;
  const changed = await G('POST', '/api/agency/password', { currentPassword: 'rahasia-agen', newPassword: 'passwordbaru1' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await api('GET', '/api/agency/overview', { token: old })).status, 401, 'sesi lama dicabut');
  await new Promise((r) => setTimeout(r, 1200));
  const relog = await api('POST', '/api/agency/login', { body: { username: 'agen.uji', password: 'passwordbaru1' } });
  assert.equal(relog.status, 200);
  assert.equal((await api('POST', '/api/agency/login', { body: { username: 'agen.uji', password: 'rahasia-agen' } })).status, 401);
});

test('agency dinonaktifkan tidak bisa login; agency luar negeri memakai USDT TRC20', async () => {
  const intl = (await A('POST', '/api/admin/agencies', { name: 'Intl', commissionRate: 0.1 })).body;
  await A('PUT', `/api/admin/agencies/${intl.id}/login`, { username: 'intl-agency', password: 'rahasia-intl', countryCode: 'US' });
  const t = (await api('POST', '/api/agency/login', { body: { username: 'intl-agency', password: 'rahasia-intl' } })).body.accessToken;
  const opt = (await api('GET', '/api/agency/withdraw/options', { token: t })).body;
  assert.equal(opt.method, 'usdt');
  assert.equal(opt.currency, 'USD');
  const saved = await api('PUT', '/api/agency/withdraw/account', { token: t, body: { provider: 'USDT (TRC20)', accountNumber: TRON, password: 'rahasia-intl' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const badAddr = await api('PUT', '/api/agency/withdraw/account', { token: t, body: { provider: 'USDT (TRC20)', accountNumber: TRON.slice(0, -1) + 'X', password: 'rahasia-intl' } });
  assert.equal(badAddr.status, 400);

  await A('PATCH', `/api/admin/agencies/${intl.id}`, { active: false });
  assert.equal((await api('GET', '/api/agency/overview', { token: t })).status, 403);
  assert.equal((await api('POST', '/api/agency/login', { body: { username: 'intl-agency', password: 'rahasia-intl' } })).status, 403);
});

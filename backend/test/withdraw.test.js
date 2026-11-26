/**
 * Penarikan diamond host.
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
let admin, sari, budi, tanpaPass, tanpaRek;

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(username) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: Number(r.body.user.id), token: r.body.accessToken };
}

async function makeHost(username, diamonds) {
  const h = await register(username);
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved', gender = 'female', profile_completed = true, diamonds = $2 WHERE id = $1`, [h.id, diamonds]);
  return h;
}

const diamonds = async (id) => Number((await db.query(`SELECT diamonds FROM users WHERE id = $1`, [id])).rows[0].diamonds);
const ACCOUNT = { provider: 'BCA', accountNumber: '1234 5678 90', accountName: 'Sari Dewi', password: 'rahasia123' };

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  const hash = await bcrypt.hash('admin123', 4);
  await db.query(`INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', $1, 'Admin', 'admin')`, [hash]);
  server = http.createServer(createApp());
  realtime.attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } });
  admin = { token: login.body.accessToken };

  sari = await makeHost('sari', 100000);
  tanpaRek = await makeHost('tanparek', 50000);
  budi = await register('budi');
  // host dari Login cepat: belum pernah mengatur password
  const q = await api('POST', '/api/auth/quick', { body: { deviceKey: 'q'.repeat(40) } });
  tanpaPass = { id: Number(q.body.user.id), token: q.body.accessToken };
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved', diamonds = 50000 WHERE id = $1`, [tanpaPass.id]);
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('info penarikan: hanya host; kurs, minimum, bank & e-wallet tersedia', async () => {
  assert.equal((await api('GET', '/api/withdrawals/options', { token: budi.token })).status, 403);
  assert.equal((await api('GET', '/api/withdrawals/options')).status, 401);
  const r = await api('GET', '/api/withdrawals/options', { token: sari.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.diamonds, 100000);
  // Nilai awal: 1 koin = Rp 2 dan host+agency 50% -> 1 diamond = Rp 2, minimal 50.000 diamond (Rp 100.000)
  assert.equal(r.body.rateIdr, 2);
  assert.equal(r.body.minDiamonds, 50000);
  assert.equal(r.body.feePercent, 0);
  assert.equal(r.body.passwordSet, true);
  assert.equal(r.body.account, null);
  assert.equal(r.body.pending, null);
  assert.ok(r.body.providers.some((p) => p.name === 'BCA' && p.kind === 'bank'));
  assert.ok(r.body.providers.some((p) => p.name === 'GoPay' && p.kind === 'ewallet'));
});

// Tes berikutnya memakai angka bulat yang mudah dihitung: Rp 10 per diamond, minimal 10.000 diamond
test('pengaturan penarikan bisa diubah admin', async () => {
  const set = await api('PATCH', '/api/admin/settings', { token: admin.token, body: { withdraw_rate_idr: 10, withdraw_min_diamonds: 10000, withdraw_fee_percent: 0 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const o = await api('GET', '/api/withdrawals/options', { token: sari.token });
  assert.equal(o.body.rateIdr, 10);
  assert.equal(o.body.minDiamonds, 10000);
});

test('akun tanpa password (Login cepat) wajib mengatur password dulu', async () => {
  const acc = await api('PUT', '/api/withdrawals/account', { token: tanpaPass.token, body: ACCOUNT });
  assert.equal(acc.status, 403);
  assert.equal(acc.body.error.code, 'PASSWORD_REQUIRED');
  const req = await api('POST', '/api/withdrawals', { token: tanpaPass.token, body: { diamonds: 10000 } });
  assert.equal(req.status, 403);
  assert.equal(req.body.error.code, 'PASSWORD_REQUIRED');
  assert.equal(await diamonds(tanpaPass.id), 50000);
});

test('rekening penarikan: wajib password, data divalidasi, nomor disamarkan', async () => {
  const put = (body) => api('PUT', '/api/withdrawals/account', { token: sari.token, body: { ...ACCOUNT, ...body } });
  assert.equal((await put({ password: 'salahsalah' })).status, 401);
  assert.equal((await put({ password: undefined })).status, 400);
  assert.equal((await put({ provider: 'Bank Abal-abal' })).status, 400);
  assert.equal((await put({ accountNumber: '12ab34' })).status, 400);
  assert.equal((await put({ accountNumber: '123' })).status, 400);
  assert.equal((await put({ accountName: 'X' })).status, 400);
  assert.equal((await put({ accountName: 'Sari <script>' })).status, 400);

  const ok = await put({});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.cooldownUntil, null, 'rekening pertama tidak kena jeda');
  const o = (await api('GET', '/api/withdrawals/options', { token: sari.token })).body;
  assert.equal(o.account.provider, 'BCA');
  assert.equal(o.account.kind, 'bank');
  assert.equal(o.account.accountNumber, '••••••7890', 'hanya 4 digit terakhir terlihat');
  assert.equal(o.account.accountName, 'Sari Dewi');
  // menyimpan data yang sama lagi tidak memicu jeda
  assert.equal((await put({})).body.cooldownUntil, null);
});

test('pengajuan: validasi, diamond ditahan, hanya satu yang berjalan', async () => {
  const req = (d, token = sari.token) => api('POST', '/api/withdrawals', { token, body: { diamonds: d } });
  assert.equal((await req(5000)).body.error.code, 'BELOW_MINIMUM');
  assert.equal((await req(0)).status, 400);
  assert.equal((await req(200000)).body.error.code, 'INSUFFICIENT_DIAMONDS');
  assert.equal((await req(10000, tanpaRek.token)).body.error.code, 'NO_PAYOUT_ACCOUNT');
  assert.equal(await diamonds(sari.id), 100000, 'penolakan tidak memotong diamond');

  const ok = await req(20000);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'pending');
  assert.equal(ok.body.diamonds, 20000);
  assert.equal(ok.body.grossIdr, 200000);
  assert.equal(ok.body.feeIdr, 0);
  assert.equal(ok.body.netIdr, 200000);
  assert.equal(ok.body.accountNumber, '••••••7890');
  assert.equal(await diamonds(sari.id), 80000, 'diamond ditahan');
  const led = (await db.query(`SELECT amount, balance_after FROM ledger WHERE user_id = $1 AND reason = 'withdraw_hold'`, [sari.id])).rows;
  assert.deepEqual(led.map((r) => [Number(r.amount), Number(r.balance_after)]), [[-20000, 80000]]);

  const second = await req(10000);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'PENDING_EXISTS');
  assert.equal(await diamonds(sari.id), 80000);
  assert.equal((await api('GET', '/api/withdrawals/options', { token: sari.token })).body.pending.id, ok.body.id);
});

test('host membatalkan pengajuan: diamond kembali; biaya dihitung dari pengaturan admin', async () => {
  const mine = (await api('GET', '/api/withdrawals', { token: sari.token })).body;
  assert.equal(mine.length, 1);
  const cancel = await api('POST', `/api/withdrawals/${mine[0].id}/cancel`, { token: sari.token });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, 'cancelled');
  assert.equal(await diamonds(sari.id), 100000);
  assert.equal((await api('POST', `/api/withdrawals/${mine[0].id}/cancel`, { token: sari.token })).status, 409);
  assert.equal((await api('POST', `/api/withdrawals/${mine[0].id}/cancel`, { token: tanpaRek.token })).status, 404, 'milik host lain');

  // validasi pengaturan oleh admin
  const bad = (b) => api('PATCH', '/api/admin/settings', { token: admin.token, body: b });
  assert.equal((await bad({ withdraw_rate_idr: 0 })).status, 400);
  assert.equal((await bad({ withdraw_fee_percent: 60 })).status, 400);
  assert.equal((await bad({ withdraw_min_diamonds: 0 })).status, 400);
  const set = await bad({ withdraw_rate_idr: 15, withdraw_fee_percent: 5, withdraw_min_diamonds: 10000 });
  assert.equal(set.status, 200, JSON.stringify(set.body));

  const w = await api('POST', '/api/withdrawals', { token: sari.token, body: { diamonds: 10000 } });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.equal(w.body.rateIdr, 15);
  assert.equal(w.body.grossIdr, 150000);
  assert.equal(w.body.feeIdr, 7500);
  assert.equal(w.body.netIdr, 142500);
  // hasil dibatalkan lagi supaya tes berikutnya bersih; kurs awal dikembalikan
  await api('POST', `/api/withdrawals/${w.body.id}/cancel`, { token: sari.token });
  await api('PATCH', '/api/admin/settings', { token: admin.token, body: { withdraw_rate_idr: 10, withdraw_fee_percent: 0 } });
});

test('mengganti rekening menahan penarikan 24 jam (cegah pembobolan akun)', async () => {
  const change = await api('PUT', '/api/withdrawals/account', {
    token: sari.token,
    body: { ...ACCOUNT, provider: 'GoPay', accountNumber: '081234567890' },
  });
  assert.equal(change.status, 200);
  assert.ok(change.body.cooldownUntil, 'jeda aktif');
  const o = (await api('GET', '/api/withdrawals/options', { token: sari.token })).body;
  assert.equal(o.account.kind, 'ewallet');
  assert.ok(o.account.cooldownUntil);
  const blocked = await api('POST', '/api/withdrawals', { token: sari.token, body: { diamonds: 10000 } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PAYOUT_COOLDOWN');
  assert.equal(await diamonds(sari.id), 100000);
  // setelah jeda lewat, bisa
  await db.query(`UPDATE payout_accounts SET cooldown_until = now() - interval '1 minute' WHERE user_id = $1`, [sari.id]);
  assert.equal((await api('POST', '/api/withdrawals', { token: sari.token, body: { diamonds: 10000 } })).status, 201);
});

test('admin: daftar, lihat rekening lengkap, bayar & tolak; hanya admin', async () => {
  assert.equal((await api('GET', '/api/admin/withdrawals', { token: budi.token })).status, 403);
  const list = await api('GET', '/api/admin/withdrawals?status=pending', { token: admin.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  const w = list.body[0];
  assert.equal(w.user.username, 'sari');
  assert.equal(w.provider, 'GoPay');
  assert.equal(w.accountNumber, '081234567890', 'admin melihat nomor lengkap untuk transfer');
  assert.equal(w.netIdr, 100000);

  const stats = await api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(stats.body.pending.withdrawals, 1);
  assert.equal(stats.body.pendingWithdrawIdr, 100000);

  // host belum boleh hapus akun saat ada penarikan berjalan
  const del = await api('POST', '/api/account/delete', { token: sari.token, body: { confirm: 'HAPUS', password: 'rahasia123' } });
  assert.equal(del.status, 409);
  assert.equal(del.body.error.code, 'WITHDRAWAL_PENDING');

  // tolak butuh alasan; diamond kembali
  assert.equal((await api('POST', `/api/admin/withdrawals/${w.id}/reject`, { token: admin.token, body: { reason: 'x' } })).status, 400);
  const rej = await api('POST', `/api/admin/withdrawals/${w.id}/reject`, { token: admin.token, body: { reason: 'Nama rekening tidak cocok' } });
  assert.equal(rej.status, 200);
  assert.equal(await diamonds(sari.id), 100000, 'diamond dikembalikan');
  assert.equal((await api('POST', `/api/admin/withdrawals/${w.id}/reject`, { token: admin.token, body: { reason: 'dua kali' } })).status, 404, 'tidak bisa diproses dua kali');
  const mine = (await api('GET', '/api/withdrawals', { token: sari.token })).body;
  assert.equal(mine[0].status, 'rejected');
  assert.equal(mine[0].adminNote, 'Nama rekening tidak cocok');

  // ajukan lagi lalu bayar
  const again = await api('POST', '/api/withdrawals', { token: sari.token, body: { diamonds: 30000 } });
  assert.equal(again.status, 201);
  const pay = await api('POST', `/api/admin/withdrawals/${again.body.id}/pay`, { token: admin.token, body: { ref: 'TRX-2026-001', note: 'Transfer GoPay' } });
  assert.equal(pay.status, 200);
  assert.equal(await diamonds(sari.id), 70000, 'diamond tetap terpotong setelah dibayar');
  assert.equal((await api('POST', `/api/admin/withdrawals/${again.body.id}/pay`, { token: admin.token, body: {} })).status, 404);
  assert.equal((await api('POST', `/api/withdrawals/${again.body.id}/cancel`, { token: sari.token })).status, 409, 'yang sudah dibayar tidak bisa dibatalkan');
  const paid = await api('GET', '/api/admin/withdrawals?status=paid', { token: admin.token });
  assert.equal(paid.body[0].transferRef, 'TRX-2026-001');
  assert.equal(paid.body[0].adminNote, 'Transfer GoPay');
  assert.equal((await api('GET', '/api/admin/withdrawals?status=rejected', { token: admin.token })).body.length, 1);
});

test('hapus akun: rekening dihapus, catatan penarikan hanya menyisakan 4 digit', async () => {
  const del = await api('POST', '/api/account/delete', { token: sari.token, body: { confirm: 'HAPUS', password: 'rahasia123' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM payout_accounts WHERE user_id = $1`, [sari.id])).rows[0].n, 0);
  const rows = (await db.query(`SELECT account_number, account_name FROM withdrawals WHERE user_id = $1`, [sari.id])).rows;
  assert.ok(rows.length >= 2);
  for (const r of rows) {
    assert.equal(r.account_number, '7890');
    assert.equal(r.account_name, '(dihapus)');
  }
});

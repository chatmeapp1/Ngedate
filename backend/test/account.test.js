/**
 * Pengaturan akun: password, username, keluar semua perangkat, hapus akun.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amora-account-'));
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

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(username, password = 'rahasia123') {
  const r = await api('POST', '/api/auth/register', { body: { username, password, displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.user.id, token: r.body.accessToken, refresh: r.body.refreshToken, username };
}

const quick = async (key) => {
  const r = await api('POST', '/api/auth/quick', { body: { deviceKey: key } });
  assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.body));
  return { id: r.body.user.id, token: r.body.accessToken, refresh: r.body.refreshToken, user: r.body.user, isNew: r.body.isNew };
};

const row = async (id) => (await db.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];

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
  admin = { id: login.body.user.id, token: login.body.accessToken };
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('akun Login cepat: atur password pertama kali tanpa password lama, lalu bisa Login via Akun', async () => {
  const key = 'k'.repeat(40);
  const q = await quick(key);
  assert.equal(q.isNew, true);
  assert.equal(q.user.passwordSet, false, 'belum punya password buatan sendiri');

  const bad = await api('POST', '/api/account/password', { token: q.token, body: { newPassword: '123' } });
  assert.equal(bad.status, 400, 'terlalu pendek');

  const set = await api('POST', '/api/account/password', { token: q.token, body: { newPassword: 'passwordbaru1' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.ok(set.body.accessToken && set.body.refreshToken);
  assert.equal((await api('GET', '/api/me', { token: set.body.accessToken })).body.passwordSet, true);

  // Sesi lama (refresh token) dicabut, yang baru berfungsi
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: q.refresh } })).status, 401);
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: set.body.refreshToken } })).status, 200);

  const login = await api('POST', '/api/auth/login', { body: { login: String(q.id), password: 'passwordbaru1' } });
  assert.equal(login.status, 200, 'login via akun (ID) dengan password yang baru diatur');
  // Login cepat dari HP yang sama tetap menuju akun yang sama
  assert.equal((await quick(key)).id, q.id);
});

test('ubah password: wajib password lama, harus berbeda', async () => {
  const u = await register('pewe');
  assert.equal((await api('GET', '/api/me', { token: u.token })).body.passwordSet, true);
  const noCurrent = await api('POST', '/api/account/password', { token: u.token, body: { newPassword: 'barubanget1' } });
  assert.equal(noCurrent.status, 400);
  const wrong = await api('POST', '/api/account/password', { token: u.token, body: { currentPassword: 'salahsalah', newPassword: 'barubanget1' } });
  assert.equal(wrong.status, 401);
  const same = await api('POST', '/api/account/password', { token: u.token, body: { currentPassword: 'rahasia123', newPassword: 'rahasia123' } });
  assert.equal(same.status, 400);
  const ok = await api('POST', '/api/account/password', { token: u.token, body: { currentPassword: 'rahasia123', newPassword: 'barubanget1' } });
  assert.equal(ok.status, 200);
  assert.equal((await api('POST', '/api/auth/login', { body: { login: 'pewe', password: 'rahasia123' } })).status, 401, 'password lama tidak berlaku');
  assert.equal((await api('POST', '/api/auth/login', { body: { login: 'pewe', password: 'barubanget1' } })).status, 200);
});

test('login via akun memakai ID pengguna + password', async () => {
  const u = await register('masukid', 'rahasia123');
  const byId = await api('POST', '/api/auth/login', { body: { login: String(u.id), password: 'rahasia123' } });
  assert.equal(byId.status, 200, JSON.stringify(byId.body));
  assert.equal(byId.body.user.id, u.id);
  assert.equal((await api('POST', '/api/auth/login', { body: { login: String(u.id), password: 'salah-salah' } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { login: '99999999', password: 'rahasia123' } })).status, 401, 'ID tak dikenal sama seperti password salah');
  // akun lama / admin tetap bisa lewat username
  assert.equal((await api('POST', '/api/auth/login', { body: { login: 'masukid', password: 'rahasia123' } })).status, 200);
  // username semua angka ditolak supaya tidak bentrok dengan ID orang lain
  const numeric = await api('POST', '/api/auth/register', { body: { username: '12345678', password: 'rahasia123' } });
  assert.equal(numeric.status, 400);
  // akun Login cepat yang belum mengatur password tidak bisa masuk dengan ID
  const q = await quick('i'.repeat(40));
  assert.equal((await api('POST', '/api/auth/login', { body: { login: String(q.id), password: 'apa-saja-123' } })).status, 401);
  // endpoint ubah username sudah tidak ada
  assert.equal((await api('POST', '/api/account/username', { token: u.token, body: { username: 'baru.baru' } })).status, 404);
});

test('keluar dari semua perangkat mencabut semua refresh token', async () => {
  const u = await register('banyakhp');
  const second = await api('POST', '/api/auth/login', { body: { login: 'banyakhp', password: 'rahasia123' } });
  assert.equal((await api('POST', '/api/account/logout-all', { token: u.token })).status, 200);
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: u.refresh } })).status, 401);
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: second.body.refreshToken } })).status, 401);
});

test('hapus akun host: konfirmasi wajib, koin tertahan kembali, data dianonimkan, tidak bisa dipakai lagi', async () => {
  const host = await register('hostdel');
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved', gender = 'female', profile_completed = true,
                    bio = 'bio rahasia', email = 'host@contoh.com', birth_date = '1999-01-01', country_code = 'ID',
                    avatar_url = 'http://x/uploads/a.jpg', diamonds = 500 WHERE id = $1`, [host.id]);
  await db.query(`INSERT INTO host_profiles (user_id, chat_price, wa_enabled, wa_number, wa_unlock_threshold) VALUES ($1, 100, true, '0812999', 20000)`, [host.id]);
  const fan = await register('fandel');
  await db.query(`UPDATE users SET gender = 'male', profile_completed = true, coins = 1000 WHERE id = $1`, [fan.id]);
  const conv = (await api('POST', '/api/conversations', { token: fan.token, body: { hostId: host.id } })).body;
  assert.equal((await api('POST', `/api/conversations/${conv.id}/messages`, { token: fan.token, body: { body: 'Halo' } })).status, 201);
  assert.equal((await row(fan.id)).coins, '900', 'koin ditahan');
  await api('POST', `/api/users/${host.id}/follow`, { token: fan.token });

  // konfirmasi & password
  assert.equal((await api('POST', '/api/account/delete', { token: host.token, body: {} })).status, 400);
  assert.equal((await api('POST', '/api/account/delete', { token: host.token, body: { confirm: 'tidak' } })).status, 400);
  const noPass = await api('POST', '/api/account/delete', { token: host.token, body: { confirm: 'HAPUS' } });
  assert.equal(noPass.status, 400, 'akun ber-password wajib mengisi password');
  assert.equal((await api('POST', '/api/account/delete', { token: host.token, body: { confirm: 'HAPUS', password: 'salah-salah' } })).status, 401);
  assert.equal((await row(host.id)).status, 'active', 'belum terhapus');
  assert.equal((await api('POST', '/api/account/delete', { token: admin.token, body: { confirm: 'HAPUS', password: 'admin123' } })).status, 403, 'admin dilindungi');

  const del = await api('POST', '/api/account/delete', { token: host.token, body: { confirm: ' hapus ', password: 'rahasia123' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));

  const gone = await row(host.id);
  assert.equal(gone.status, 'deleted');
  assert.equal(gone.username, `deleted_${host.id}`);
  assert.equal(gone.display_name, 'Akun dihapus');
  for (const col of ['email', 'bio', 'birth_date', 'avatar_url', 'country_code', 'gender']) assert.equal(gone[col], null, col);
  assert.equal(gone.verified, false);
  assert.equal(Number(gone.diamonds), 0);
  const prof = (await db.query(`SELECT wa_number, wa_enabled FROM host_profiles WHERE user_id = $1`, [host.id])).rows[0];
  assert.deepEqual({ n: prof.wa_number, e: prof.wa_enabled }, { n: null, e: false });

  // koin yang ditahan kembali ke pengirim; hubungan sosial hilang; riwayat saldo tercatat
  assert.equal((await row(fan.id)).coins, '1000');
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM follows WHERE followee_id = $1`, [host.id])).rows[0].n, 0);
  const led = (await db.query(`SELECT currency, amount FROM ledger WHERE user_id = $1 AND reason = 'account_deleted'`, [host.id])).rows;
  assert.deepEqual(led.map((r) => `${r.currency}:${r.amount}`), ['diamond:-500']);

  // tidak bisa dipakai lagi
  const me = await api('GET', '/api/me', { token: host.token });
  assert.equal(me.status, 403);
  assert.equal(me.body.error.code, 'ACCOUNT_DELETED');
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: host.refresh } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { login: 'hostdel', password: 'rahasia123' } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { login: `deleted_${host.id}`, password: 'rahasia123' } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { login: String(host.id), password: 'rahasia123' } })).status, 401, 'ID akun terhapus tidak bisa masuk');

  // tidak muncul di daftar & tidak bisa dikirimi pesan
  assert.ok(!(await api('GET', '/api/hosts', { token: fan.token })).body.some((h) => h.id === host.id));
  assert.equal((await api('GET', `/api/hosts/${host.id}`, { token: fan.token })).status, 404);
  const send = await api('POST', `/api/conversations/${conv.id}/messages`, { token: fan.token, body: { body: 'Masih ada?' } });
  assert.equal(send.status, 403);
  assert.equal(send.body.error.code, 'ACCOUNT_DELETED');
  assert.equal((await row(fan.id)).coins, '1000', 'tidak ada koin terpotong');

  // admin tidak bisa menghidupkan lagi
  assert.equal((await api('PATCH', `/api/admin/users/${host.id}/status`, { token: admin.token, body: { status: 'active' } })).status, 404);
  assert.equal((await api('PATCH', `/api/admin/users/${host.id}/role`, { token: admin.token, body: { role: 'user' } })).status, 404);
  assert.equal((await row(host.id)).status, 'deleted');
  // dan bisa disaring di daftar admin
  const list = await api('GET', '/api/admin/users?status=deleted', { token: admin.token });
  assert.deepEqual(list.body.map((u) => u.id), [host.id]);
});

test('hapus akun Login cepat: cukup ketik HAPUS; HP yang sama mendapat akun baru yang kosong', async () => {
  const key = 'z'.repeat(40);
  const q = await quick(key);
  await db.query(`UPDATE users SET coins = 700, bio = 'catatan' WHERE id = $1`, [q.id]);
  const del = await api('POST', '/api/account/delete', { token: q.token, body: { confirm: 'HAPUS' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await row(q.id)).status, 'deleted');
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM device_accounts WHERE user_id = $1`, [q.id])).rows[0].n, 0);

  const again = await quick(key);
  assert.equal(again.isNew, true, 'dibuatkan akun baru');
  assert.notEqual(again.id, q.id);
  assert.equal(again.user.bio, null);
  assert.equal(Number((await row(again.id)).coins), 0, 'koin lama tidak ikut');
  // menghapus dua kali ditolak
  assert.equal((await api('POST', '/api/account/delete', { token: q.token, body: { confirm: 'HAPUS' } })).status, 403);
});

test('halaman publik cara menghapus akun tersedia tanpa login', async () => {
  for (const p of ['/hapus-akun', '/delete-account']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Pengaturan akun/);
    assert.match(html, /HAPUS/);
    assert.ok(!html.includes('{{SUPPORT}}'), 'kontak terisi');
  }
});

/**
 * Lupa password: kode pemulihan, kunci percobaan, dan atur ulang oleh admin.
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

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const register = async (name) => {
  const r = await api('POST', '/api/auth/register', { body: { username: name, password: 'rahasia123', displayName: name } });
  return { id: r.body.user.id, token: r.body.accessToken };
};

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
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

const quick = async () => {
  const key = require('crypto').randomBytes(24).toString('hex');
  const r = await api('POST', '/api/auth/quick', { body: { deviceKey: key } });
  return { id: r.body.user.id, token: r.body.accessToken };
};
const login = (id, password) => api('POST', '/api/auth/login', { body: { login: String(id), password } });
const reset = (login, code, newPassword) => api('POST', '/api/auth/forgot/reset', { body: { login: String(login), code, newPassword } });

test('akun Login cepat: atur password pertama kali -> dapat kode pemulihan sekali saja', async () => {
  const u = await quick();
  const me0 = (await api('GET', '/api/me', { token: u.token })).body;
  assert.equal(me0.hasRecoveryCode, false);
  const set = await api('POST', '/api/account/password', { token: u.token, body: { newPassword: 'rahasia123' } });
  assert.equal(set.status, 200);
  assert.match(set.body.recoveryCode, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  const me1 = (await api('GET', '/api/me', { token: set.body.accessToken })).body;
  assert.equal(me1.hasRecoveryCode, true);
  // mengganti password lagi tidak membuat kode baru
  const again = await api('POST', '/api/account/password', { token: set.body.accessToken, body: { currentPassword: 'rahasia123', newPassword: 'rahasia456' } });
  assert.equal(again.body.recoveryCode, null);
  // kode tersimpan sebagai hash, bukan teks asli
  const stored = (await db.query(`SELECT recovery_hash FROM users WHERE id = $1`, [u.id])).rows[0].recovery_hash;
  assert.ok(stored && !stored.includes(set.body.recoveryCode.replace(/-/g, '')));
});

test('lupa password: kode benar mengganti password, sesi lama keluar, kode lama diganti kode baru', async () => {
  const u = await register('lupapass');
  // akun yang belum punya kode tidak bisa direset dengan kode
  assert.equal((await reset(u.id, 'ABCD-EFGH-JKMN', 'passwordbaru')).status, 401);
  const gen = await api('POST', '/api/account/recovery-code', { token: u.token, body: { password: 'rahasia123' } });
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  const code = gen.body.recoveryCode;
  // buat kode butuh password yang benar
  assert.equal((await api('POST', '/api/account/recovery-code', { token: u.token, body: { password: 'salah' } })).status, 401);

  const refreshOld = (await login(u.id, 'rahasia123')).body.refreshToken;
  // kode ditulis huruf kecil tanpa strip tetap diterima
  const r = await reset(u.id, code.toLowerCase().replace(/-/g, ' '), 'passwordbaru');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(r.body.recoveryCode, code, 'kode baru dibuat');
  assert.equal((await login(u.id, 'rahasia123')).status, 401, 'password lama tidak berlaku');
  assert.equal((await login(u.id, 'passwordbaru')).status, 200);
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: refreshOld } })).status, 401, 'sesi lama keluar');
  // kode yang sudah dipakai tidak berlaku lagi; kode baru berlaku
  assert.equal((await reset(u.id, code, 'passwordlain')).status, 401);
  assert.equal((await reset(u.id, r.body.recoveryCode, 'passwordlain2')).status, 200);
  assert.equal((await reset(u.id, 'ZZZZ-ZZZZ-ZZZZ', 'xx')).status, 400, 'password baru minimal 6 karakter');
});

test('percobaan salah dibatasi: 5 kali salah mengunci 1 jam; pesan sama untuk akun yang tidak ada', async () => {
  const u = await register('terkunci');
  const code = (await api('POST', '/api/account/recovery-code', { token: u.token, body: { password: 'rahasia123' } })).body.recoveryCode;
  const miss = await reset(99999999, 'ABCD-EFGH-JKMN', 'passwordbaru');
  const wrong = await reset(u.id, 'ABCD-EFGH-JKMN', 'passwordbaru');
  assert.equal(miss.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(miss.body.error.message, wrong.body.error.message, 'tidak membocorkan apakah akun ada');
  for (let i = 0; i < 4; i++) assert.equal((await reset(u.id, 'AAAA-AAAA-AAAA', 'passwordbaru')).status, 401);
  // sudah 5 kali salah: sekarang terkunci, bahkan dengan kode yang benar
  const locked = await reset(u.id, code, 'passwordbaru');
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'RECOVERY_LOCKED');
  assert.equal((await login(u.id, 'rahasia123')).status, 200, 'password lama tetap utuh');
  // setelah kunci habis, kode benar berfungsi dan menghapus hitungan salah
  await db.query(`UPDATE users SET recovery_locked_until = now() - interval '1 minute' WHERE id = $1`, [u.id]);
  assert.equal((await reset(u.id, code, 'passwordbaru')).status, 200);
  assert.equal((await db.query(`SELECT recovery_failed FROM users WHERE id = $1`, [u.id])).rows[0].recovery_failed, 0);
});

test('admin mengatur ulang password: password sementara, wajib diganti, sesi lama keluar, admin tidak bisa direset', async () => {
  const u = await register('mintaadmin');
  const refreshOld = (await login(u.id, 'rahasia123')).body.refreshToken;
  assert.equal((await api('POST', `/api/admin/users/${u.id}/reset-password`, { token: u.token })).status, 403, 'hanya admin');
  const r = await api('POST', `/api/admin/users/${u.id}/reset-password`, { token: admin });
  assert.equal(r.status, 200);
  assert.match(r.body.tempPassword, /^[A-HJKMNP-Z2-9]{10}$/);
  assert.equal((await login(u.id, 'rahasia123')).status, 401);
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: refreshOld } })).status, 401);
  const l = await login(u.id, r.body.tempPassword);
  assert.equal(l.status, 200);
  assert.equal(l.body.user.mustChangePassword, true);
  // ganti password sementara -> tidak wajib lagi
  const ch = await api('POST', '/api/account/password', { token: l.body.accessToken, body: { currentPassword: r.body.tempPassword, newPassword: 'passwordbaru1' } });
  assert.equal(ch.status, 200);
  assert.equal((await api('GET', '/api/me', { token: ch.body.accessToken })).body.mustChangePassword, false);
  const adminId = (await db.query(`SELECT id FROM users WHERE role = 'admin'`)).rows[0].id;
  assert.equal((await api('POST', `/api/admin/users/${adminId}/reset-password`, { token: admin })).status, 403);
  assert.equal((await api('POST', '/api/admin/users/99999999/reset-password', { token: admin })).status, 404);
});

test('kontak admin untuk bantuan akun tersedia tanpa login', async () => {
  await api('PATCH', '/api/admin/settings', { token: admin, body: { topup_contact: '081234567890' } });
  const s = await api('GET', '/api/auth/support');
  assert.equal(s.status, 200);
  assert.equal(s.body.whatsapp, '6281234567890');
});

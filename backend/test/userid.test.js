/**
 * ID pengguna 6 digit (mulai 100001) dan skrip pengosongan database.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amora-userid-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');

let server;
let base;

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const register = async (username) => {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: Number(r.body.user.id), token: r.body.accessToken };
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
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('akun pertama mulai dari 100001, berurutan, semuanya 6 digit', async () => {
  const admin = (await db.query(`SELECT id FROM users WHERE username = 'admin'`)).rows[0];
  assert.equal(Number(admin.id), 100001);
  const a = await register('satu');
  const b = await register('dua');
  assert.equal(a.id, 100002);
  assert.equal(b.id, 100003);
  assert.equal(String(a.id).length, 6);
  // login memakai ID 6 digit
  const login = await api('POST', '/api/auth/login', { body: { login: String(a.id), password: 'rahasia123' } });
  assert.equal(login.status, 200);
  assert.equal(Number(login.body.user.id), a.id);
  // pencarian admin berdasarkan ID persis
  const admLogin = await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } });
  const found = await api('GET', `/api/admin/users?q=${b.id}`, { token: admLogin.body.accessToken });
  assert.deepEqual(found.body.map((u) => Number(u.id)), [b.id]);
});

test('menjalankan ulang migrasi ID tidak pernah menurunkan nomor berikutnya', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '009_user_id_6digit.sql'), 'utf8');
  const before = Number((await db.query(`SELECT MAX(id) AS m FROM users`)).rows[0].m);
  await db.query(sql);
  const next = await register('tiga');
  assert.equal(next.id, before + 1, 'tidak mundur ke 100001 dan tidak ada ID ganda');
  // database lama yang ID-nya sudah di atas 100000 tetap lanjut dari ID terbesar
  await db.query(`SELECT setval('users_id_seq', 5000)`);
  await db.query(sql);
  assert.equal((await register('empat')).id, next.id + 1);
});

test('reset-db: ditolak tanpa konfirmasi, lalu mengosongkan dan ID mulai lagi dari 100001', async () => {
  const stray = path.join(UPLOAD_DIR, '1795531176145-bf4661083719799e.jpg');
  const other = path.join(UPLOAD_DIR, 'catatan-penting.txt');
  fs.writeFileSync(stray, 'x');
  fs.writeFileSync(other, 'jangan dihapus');

  const env = { ...process.env, ADMIN_USERNAME: 'Amora', ADMIN_PASSWORD: 'amora123', UPLOAD_DIR };
  delete env.CONFIRM_RESET;

  // Tanpa konfirmasi: batal, data utuh
  const refused = spawnSync('node', ['src/reset.js'], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /DIBATALKAN/);
  const stillThere = Number((await db.query(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n);
  assert.ok(stillThere >= 4, 'data tidak tersentuh');
  assert.ok(fs.existsSync(stray));

  // Konfirmasi salah juga batal
  const wrong = spawnSync('node', ['src/reset.js'], { cwd: path.join(__dirname, '..'), env: { ...env, CONFIRM_RESET: 'ya' }, encoding: 'utf8' });
  assert.equal(wrong.status, 1);

  // Dengan konfirmasi benar
  const done = spawnSync('node', ['src/reset.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...env, CONFIRM_RESET: 'HAPUS-SEMUA-DATA' },
    encoding: 'utf8',
  });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /file unggahan dihapus/);
  assert.match(done.stdout, /admin "amora" siap/);

  const users = (await db.query(`SELECT id, username, role FROM users ORDER BY id`)).rows;
  assert.deepEqual(users.map((u) => [Number(u.id), u.username, u.role]), [[100001, 'amora', 'admin']]);
  assert.equal(Number((await db.query(`SELECT COUNT(*)::int AS n FROM gifts`)).rows[0].n), 8, 'gift contoh dibuat ulang');
  assert.equal(fs.existsSync(stray), false, 'file unggahan buatan aplikasi dihapus');
  assert.equal(fs.existsSync(other), true, 'file lain di folder yang sama tidak disentuh');

  // Admin baru bisa login, dan akun berikutnya 100002
  assert.equal((await api('POST', '/api/auth/login', { body: { login: 'Amora', password: 'amora123' } })).status, 200);
  assert.equal((await register('setelahreset')).id, 100002);
});

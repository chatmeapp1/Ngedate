/**
 * Panel admin: statistik, filter pengguna, unggah gambar, hapus gambar gift, halaman statis.
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
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amora-admin-'));
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');

let server;
let base;
let admin, budi, sari;

async function api(method, p, { token, body, form } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + p, { method, headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(username) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.user.id, token: r.body.accessToken };
}

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
  assert.equal(login.body.user.role, 'admin');
  admin = { token: login.body.accessToken };
  budi = await register('budi');
  sari = await register('sari');
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved' WHERE id = $1`, [sari.id]);
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('halaman panel admin disajikan tanpa login, API tetap butuh admin', async () => {
  for (const f of ['', 'admin.js', 'admin.css']) {
    const res = await fetch(`${base}/admin/${f}`);
    assert.equal(res.status, 200, f);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await api('GET', '/api/admin/stats')).status, 401);
  assert.equal((await api('GET', '/api/admin/stats', { token: budi.token })).status, 403);
});

test('statistik dashboard menghitung antrean tinjauan dan aktivitas', async () => {
  const r = await api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.users.user, 1);
  assert.equal(r.body.users.host, 1);
  assert.deepEqual(r.body.pending, { verifications: 0, photos: 0, avatars: 0 });
  assert.equal(r.body.newUsers24h, 3);
  assert.equal(r.body.messages24h, 0);

  await db.query(`UPDATE users SET pending_avatar_url = 'http://x/uploads/a.jpg' WHERE id = $1`, [sari.id]);
  const again = await api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(again.body.pending.avatars, 1);
});

test('daftar pengguna bisa disaring peran & status', async () => {
  const hosts = await api('GET', '/api/admin/users?role=host', { token: admin.token });
  assert.deepEqual(hosts.body.map((u) => u.username), ['sari']);
  await api('PATCH', `/api/admin/users/${budi.id}/status`, { token: admin.token, body: { status: 'suspended' } });
  const sus = await api('GET', '/api/admin/users?status=suspended', { token: admin.token });
  assert.deepEqual(sus.body.map((u) => u.username), ['budi']);
  const both = await api('GET', '/api/admin/users?role=host&status=suspended', { token: admin.token });
  assert.equal(both.body.length, 0);
  assert.equal((await api('GET', '/api/admin/users?role=bukan', { token: admin.token })).status, 400);
});

test('unggah gambar gift lalu hapus gambarnya', async () => {
  // PNG 1x1 valid
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'g.png');
  const up = await api('POST', '/api/admin/upload', { token: admin.token, form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.match(up.body.url, /\/uploads\/.+\.png$/);
  const file = await fetch(up.body.url.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(file.status, 200);

  // bukan gambar ditolak
  const bad = new FormData();
  bad.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  assert.equal((await api('POST', '/api/admin/upload', { token: admin.token, form: bad })).status, 400);
  assert.equal((await api('POST', '/api/admin/upload', { token: budi.token, form })).status, 403);

  const g = await api('POST', '/api/admin/gifts', { token: admin.token, body: { name: 'Bunga', price: 50, icon: '🌸', imageUrl: up.body.url } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.equal(g.body.imageUrl, up.body.url);
  const cleared = await api('PATCH', `/api/admin/gifts/${g.body.id}`, { token: admin.token, body: { imageUrl: '' } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.imageUrl, null);
  assert.equal(cleared.body.icon, '🌸', 'emoji tetap ada');
});

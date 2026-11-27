/**
 * Momen: posting host, lihat/suka/komentar oleh pengguna.
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
const A = (method, p, body) => api(method, p, { token: admin, body });
const register = async (name) => {
  const r = await api('POST', '/api/auth/register', { body: { username: name, password: 'rahasia123', displayName: name } });
  return { id: r.body.user.id, token: r.body.accessToken };
};
async function makeHost(name) {
  const h = await register(name);
  await A('PATCH', `/api/admin/users/${h.id}/role`, { role: 'host' });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [h.id]);
  return h;
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
  admin = (await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } })).body.accessToken;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

const postForm = (token, fields) => {
  const fd = new FormData();
  for (const [k, val] of Object.entries(fields)) fd.append(k, val);
  return fetch(base + '/api/moments', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }));
};

test('hanya host yang bisa memposting; teks berisi kontak ditolak', async () => {
  const host = await makeHost('hostmomen');
  const user = await register('usermomen');
  assert.equal((await postForm(user.token, { body: 'halo' })).status, 403);
  assert.equal((await postForm(host.token, {})).status, 400);
  assert.equal((await postForm(host.token, { body: 'hubungi wa.me/62812345678' })).status, 400);
  const ok = await postForm(host.token, { body: 'Selamat pagi semua' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.host.id, host.id);
});

test('pengguna melihat, suka, komentar; dilihat bertambah; blokir menyembunyikan', async () => {
  const host = await makeHost('hostmomen2');
  const user = await register('usermomen2');
  const m = (await postForm(host.token, { body: 'Momen kedua' })).body;

  const list = await api('GET', '/api/moments?tab=new', { token: user.token });
  assert.ok(list.body.items.some((x) => x.id === m.id));

  const d1 = await api('GET', `/api/moments/${m.id}`, { token: user.token });
  assert.equal(d1.body.views, 1);
  // pemilik melihat sendiri tidak menambah
  assert.equal((await api('GET', `/api/moments/${m.id}`, { token: host.token })).body.views, 1);

  const like = await api('POST', `/api/moments/${m.id}/like`, { token: user.token });
  assert.deepEqual([like.body.liked, like.body.likes], [true, 1]);
  const unlike = await api('POST', `/api/moments/${m.id}/like`, { token: user.token });
  assert.deepEqual([unlike.body.liked, unlike.body.likes], [false, 0]);

  assert.equal((await api('POST', `/api/moments/${m.id}/comments`, { token: user.token, body: { body: 'cantik' } })).status, 201);
  assert.equal((await api('POST', `/api/moments/${m.id}/comments`, { token: user.token, body: { body: 'chat wa 081234567890' } })).status, 400);
  const cm = await api('GET', `/api/moments/${m.id}/comments`, { token: user.token });
  assert.equal(cm.body.length, 1);
  assert.equal((await api('GET', `/api/moments/${m.id}`, { token: user.token })).body.comments, 1);

  const mine = await api('GET', '/api/moments?tab=mine', { token: host.token });
  assert.ok(mine.body.items.every((x) => x.host.id === host.id));

  await api('POST', '/api/blocks', { token: user.token, body: { userId: host.id } });
  assert.equal((await api('GET', `/api/moments/${m.id}`, { token: user.token })).status, 404);

  // hanya pemilik yang bisa menghapus
  assert.equal((await api('DELETE', `/api/moments/${m.id}`, { token: user.token })).body.ok, true);
  assert.equal((await api('GET', `/api/moments?tab=mine`, { token: host.token })).body.items.length, 1);
  await api('DELETE', `/api/moments/${m.id}`, { token: host.token });
  assert.equal((await api('GET', `/api/moments?tab=mine`, { token: host.token })).body.items.length, 0);
});

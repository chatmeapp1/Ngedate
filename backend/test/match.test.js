/**
 * Match: tumpukan kartu host, lewati, suka.
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

test('tumpukan match: lewati & suka menyembunyikan host; blokir & host tanpa foto tidak muncul', async () => {
  const h1 = await makeHost('matchsatu');
  const h2 = await makeHost('matchdua');
  const h3 = await makeHost('matchtiga'); // tanpa foto: tidak muncul
  await db.query(`UPDATE users SET avatar_url = 'http://x/a.jpg' WHERE id = ANY($1)`, [[h1.id, h2.id]]);
  const user = await register('penggunamatch');

  const ids = async () => (await api('GET', '/api/match/deck?limit=20', { token: user.token })).body.map((x) => x.id);
  let d = await ids();
  assert.ok(d.includes(h1.id) && d.includes(h2.id) && !d.includes(h3.id));

  assert.equal((await api('POST', `/api/match/${h1.id}/skip`, { token: user.token })).status, 200);
  d = await ids();
  assert.ok(!d.includes(h1.id) && d.includes(h2.id));

  assert.equal((await api('POST', `/api/users/${h2.id}/like`, { token: user.token })).status, 200);
  assert.ok(!(await ids()).includes(h2.id));

  // host tidak boleh memakai match
  assert.equal((await api('GET', '/api/match/deck', { token: h1.token })).status, 403);
});

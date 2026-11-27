/**
 * Host menyukai dan mengikuti pengguna dari profil pengguna.
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

test('host bisa suka & ikuti pengguna; pengguna tidak bisa menyukai pengguna lain', async () => {
  const host = await makeHost('hostsuka');
  const user = await register('penggunadisuka');
  const other = await register('penggunalain');
  await db.query(`UPDATE users SET gender = 'male', profile_completed = true WHERE id = ANY($1)`, [[user.id, other.id]]);

  let p = (await api('GET', `/api/members/${user.id}`, { token: host.token })).body;
  assert.deepEqual([p.isLiked, p.isFollowing, p.likes, p.followers], [false, false, 0, 0]);

  const like = await api('POST', `/api/users/${user.id}/like`, { token: host.token });
  assert.equal(like.status, 200);
  const follow = await api('POST', `/api/users/${user.id}/follow`, { token: host.token });
  assert.equal(follow.status, 200);
  p = (await api('GET', `/api/members/${user.id}`, { token: host.token })).body;
  assert.deepEqual([p.isLiked, p.isFollowing, p.likes, p.followers], [true, true, 1, 1]);

  // batal
  await api('DELETE', `/api/users/${user.id}/like`, { token: host.token });
  await api('DELETE', `/api/users/${user.id}/follow`, { token: host.token });
  p = (await api('GET', `/api/members/${user.id}`, { token: host.token })).body;
  assert.deepEqual([p.isLiked, p.isFollowing], [false, false]);

  // pengguna ke pengguna tetap ditolak
  assert.equal((await api('POST', `/api/users/${other.id}/like`, { token: user.token })).status, 400);
  // pengguna masih bisa menyukai host
  assert.equal((await api('POST', `/api/users/${host.id}/like`, { token: user.token })).status, 200);
});

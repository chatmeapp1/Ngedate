/**
 * Notifikasi sistem: top up, foto disetujui/ditolak.
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

const notes = async (u) => (await api('GET', '/api/notifications', { token: u.token })).body;

test('top up admin, foto album, foto profil, dan momen menghasilkan notifikasi; bisa ditandai dibaca', async () => {
  const host = await makeHost('hostnotif');
  const user = await register('usernotif');

  await A('POST', `/api/admin/users/${user.id}/coins`, { amount: 5000 });
  let n = await notes(user);
  assert.ok(n.some((x) => x.type === 'topup' && /5\.000/.test(x.body)));
  assert.equal((await api('GET', '/api/notifications/unread-count', { token: user.token })).body.total, 1);

  // foto album: setujui & tolak
  const { rows: ph } = await db.query(
    `INSERT INTO user_photos (user_id, url, status) VALUES ($1, 'http://x/1.jpg', 'pending'), ($1, 'http://x/2.jpg', 'pending') RETURNING id`, [host.id]);
  await A('POST', `/api/admin/photos/${ph[0].id}/approve`);
  await A('POST', `/api/admin/photos/${ph[1].id}/reject`, { reason: 'buram sekali' });
  n = await notes(host);
  assert.ok(n.some((x) => x.type === 'photo' && /disetujui/.test(x.title)));
  assert.ok(n.some((x) => x.type === 'photo' && /ditolak/.test(x.title) && /buram/.test(x.body)));

  // foto profil
  await db.query(`UPDATE users SET pending_avatar_url = 'http://x/new.jpg' WHERE id = $1`, [host.id]);
  await A('POST', `/api/admin/users/${host.id}/avatar/approve`);
  assert.ok((await notes(host)).some((x) => x.type === 'avatar' && /disetujui/.test(x.title)));

  // momen
  const { rows: mo } = await db.query(`INSERT INTO moments (host_id, body, image_url, status) VALUES ($1, 'a', 'http://x/m.jpg', 'pending') RETURNING id`, [host.id]);
  await A('POST', `/api/admin/moments/${mo[0].id}/approve`);
  assert.ok((await notes(host)).some((x) => x.type === 'moment' && /disetujui/.test(x.title)));

  // hanya milik sendiri; tandai dibaca
  assert.equal((await notes(user)).some((x) => x.type === 'photo'), false);
  await api('POST', '/api/notifications/read', { token: host.token });
  assert.equal((await api('GET', '/api/notifications/unread-count', { token: host.token })).body.total, 0);
  assert.equal((await api('GET', '/api/notifications')).status, 401);
});

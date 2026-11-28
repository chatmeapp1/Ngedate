/**
 * Bingkai avatar: hanya satu terpasang (VIP atau hadiah check-in), pilihan disimpan.
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

const me = async (token) => (await api('GET', '/api/me', { token })).body.membership;

test('punya bingkai VIP dan check-in: awal VIP, bisa ditukar, kedaluwarsa kembali ke VIP, validasi kepemilikan', async () => {
  const u = await register('duabingkai');
  // belum punya apa pun
  assert.equal((await me(u.token)).frameWorn, null);
  assert.equal((await api('POST', '/api/me/frame', { token: u.token, body: { choice: 'vip' } })).status, 400);
  assert.equal((await api('POST', '/api/me/frame', { token: u.token, body: { choice: 'checkin' } })).status, 400);
  assert.equal((await api('POST', '/api/me/frame', { token: u.token, body: { choice: 'lain' } })).status, 400);

  // hanya bingkai check-in
  await db.query(`UPDATE users SET checkin_frame = 2, checkin_frame_until = now() + interval '3 days' WHERE id = $1`, [u.id]);
  assert.equal((await me(u.token)).frameWorn, 'checkin');

  // jadi VIP: otomatis VIP yang terpasang (tidak dobel)
  await db.query(`UPDATE users SET topup_total = 1000000000 WHERE id = $1`, [u.id]);
  let m = await me(u.token);
  assert.equal(m.frameWorn, 'vip');
  assert.ok(m.vip > 0 && m.checkinFrame === 2);

  // tukar ke bingkai check-in
  const sw = await api('POST', '/api/me/frame', { token: u.token, body: { choice: 'checkin' } });
  assert.equal(sw.status, 200);
  assert.equal(sw.body.membership.frameWorn, 'checkin');
  assert.equal((await me(u.token)).frameChoice, 'checkin');
  // dan kembali ke VIP
  assert.equal((await api('POST', '/api/me/frame', { token: u.token, body: { choice: 'vip' } })).body.membership.frameWorn, 'vip');

  // pilihan check-in tetapi sudah kedaluwarsa: kembali ke VIP
  await api('POST', '/api/me/frame', { token: u.token, body: { choice: 'checkin' } });
  await db.query(`UPDATE users SET checkin_frame_until = now() - interval '1 hour' WHERE id = $1`, [u.id]);
  m = await me(u.token);
  assert.equal(m.frameWorn, 'vip');
  assert.equal(m.checkinFrameExpired, 2);
  assert.equal((await api('POST', '/api/me/frame', { token: u.token, body: { choice: 'checkin' } })).status, 400);
});

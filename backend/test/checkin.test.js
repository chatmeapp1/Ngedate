/**
 * Check-in harian: 7 hari berurutan, hadiah koin, reset jika lewat sehari.
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
const coins = async (u) => Number((await db.query(`SELECT coins FROM users WHERE id = $1`, [u.id])).rows[0].coins);

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

// Majukan semua check-in mundur sehari (seolah klaim terakhir kemarin)
const rewind = (u, days = 1) => db.query(`UPDATE user_checkins SET day = day - $2::int WHERE user_id = $1`, [u.id, days]);

test('klaim hari 1, tidak bisa dua kali sehari, koin masuk dan tercatat', async () => {
  const u = await register('checkinsatu');
  const st = (await api('GET', '/api/checkin', { token: u.token })).body;
  assert.deepEqual([st.claimedToday, st.currentDay, st.claimedDays, st.rewards.length], [false, 1, 0, 7]);

  const c = await api('POST', '/api/checkin/claim', { token: u.token });
  assert.equal(c.status, 200);
  assert.equal(c.body.coins, 5);
  assert.equal(c.body.claimedToday, true);
  assert.equal(await coins(u), 5);
  assert.equal((await api('POST', '/api/checkin/claim', { token: u.token })).status, 409);
  assert.equal(await coins(u), 5);
  const led = (await db.query(`SELECT amount, reason FROM ledger WHERE user_id = $1 AND reason = 'checkin'`, [u.id])).rows;
  assert.equal(led.length, 1);
});

test('7 hari berturut-turut lalu mengulang; lewat sehari mengulang dari hari 1', async () => {
  const u = await register('checkindua');
  const got = [];
  for (let i = 0; i < 7; i++) {
    const c = await api('POST', '/api/checkin/claim', { token: u.token });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    got.push(c.body.coins);
    assert.equal(c.body.day, i + 1);
    await rewind(u); // besok
  }
  assert.deepEqual(got, [5, 5, 10, 10, 15, 15, 40]);
  assert.equal(await coins(u), 100);
  // setelah hari ke-7: siklus baru dari hari 1
  const next = (await api('GET', '/api/checkin', { token: u.token })).body;
  assert.deepEqual([next.currentDay, next.claimedDays], [1, 0]);
  assert.equal((await api('POST', '/api/checkin/claim', { token: u.token })).body.day, 1);

  // lewat 2 hari -> kembali ke hari 1
  const v = await register('checkintiga');
  await api('POST', '/api/checkin/claim', { token: v.token });
  await rewind(v);
  await api('POST', '/api/checkin/claim', { token: v.token }); // hari 2
  await rewind(v, 3);
  const miss = await api('POST', '/api/checkin/claim', { token: v.token });
  assert.equal(miss.body.day, 1);
});

test('host tidak bisa check-in; admin mengatur hadiah (7 angka)', async () => {
  const h = await register('hostcheckin');
  await A('PATCH', `/api/admin/users/${h.id}/role`, { role: 'host' });
  assert.equal((await api('POST', '/api/checkin/claim', { token: h.token })).status, 403);

  assert.equal((await A('PATCH', '/api/admin/settings', { checkin_rewards: '1,2,3' })).status, 400);
  assert.equal((await A('PATCH', '/api/admin/settings', { checkin_rewards: '1,2,3,4,5,6,5000' })).status, 400);
  assert.equal((await A('PATCH', '/api/admin/settings', { checkin_rewards: '2,2,2,2,2,2,20' })).status, 200);
  const u = await register('checkinempat');
  assert.deepEqual((await api('GET', '/api/checkin', { token: u.token })).body.rewards, [2, 2, 2, 2, 2, 2, 20]);
  assert.equal((await api('GET', '/api/checkin')).status, 401);
});

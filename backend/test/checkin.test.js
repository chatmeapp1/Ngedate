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

const myMembership = async (u) => (await api('GET', '/api/me', { token: u.token })).body.membership;

test('klaim hari 1 (10 koin), tidak bisa dua kali sehari, koin masuk dan tercatat', async () => {
  const u = await register('checkinsatu');
  const st = (await api('GET', '/api/checkin', { token: u.token })).body;
  assert.deepEqual([st.claimedToday, st.currentDay, st.claimedDays, st.rewards.length], [false, 1, 0, 7]);
  assert.deepEqual(st.reward, { type: 'coins', amount: 10 });

  const c = await api('POST', '/api/checkin/claim', { token: u.token });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.granted, { type: 'coins', amount: 10 });
  assert.equal(c.body.claimedToday, true);
  assert.equal(await coins(u), 10);
  assert.equal((await api('POST', '/api/checkin/claim', { token: u.token })).status, 409);
  assert.equal(await coins(u), 10);
  assert.equal((await db.query(`SELECT 1 FROM ledger WHERE user_id = $1 AND reason = 'checkin'`, [u.id])).rows.length, 1);
});

test('7 hari: koin, bingkai 3 hari, 5 pesan gratis, koin, 5 pesan gratis, bingkai, 100 koin; lalu mengulang', async () => {
  const u = await register('checkindua');
  const granted = [];
  for (let i = 0; i < 7; i++) {
    const c = await api('POST', '/api/checkin/claim', { token: u.token });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.day, i + 1);
    granted.push(c.body.granted);
    if (i === 1) {
      const m = await myMembership(u);
      assert.equal(m.checkinFrame, 1, 'bingkai model 1 aktif setelah hari 2');
      // bingkai otomatis lepas setelah 3 hari
      await db.query(`UPDATE users SET checkin_frame_until = now() - interval '1 minute' WHERE id = $1`, [u.id]);
      assert.equal((await myMembership(u)).checkinFrame, 0, 'bingkai lepas setelah kedaluwarsa');
    }
    if (i === 2) assert.equal((await myMembership(u)).checkinCards, 5);
    await rewind(u);
  }
  assert.deepEqual(granted.map((g) => g.type), ['coins', 'frame', 'cards', 'coins', 'cards', 'frame', 'coins']);
  assert.equal(await coins(u), 10 + 10 + 100);
  const m = await myMembership(u);
  assert.deepEqual([m.checkinCards, m.checkinFrame], [10, 2]);

  const next = (await api('GET', '/api/checkin', { token: u.token })).body;
  assert.deepEqual([next.currentDay, next.claimedDays], [1, 0]);

  // lewat 2 hari -> kembali ke hari 1
  const v = await register('checkintiga');
  await api('POST', '/api/checkin/claim', { token: v.token });
  await rewind(v);
  await api('POST', '/api/checkin/claim', { token: v.token }); // hari 2
  await rewind(v, 3);
  assert.equal((await api('POST', '/api/checkin/claim', { token: v.token })).body.day, 1);
});

test('pesan gratis dari check-in: koin pengguna tidak terpotong, host dibayar app, kredit berkurang', async () => {
  const host = await register('hostchatgratis');
  await A('PATCH', `/api/admin/users/${host.id}/role`, { role: 'host' });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [host.id]);
  await db.query(`INSERT INTO host_profiles (user_id, chat_price) VALUES ($1, 100) ON CONFLICT (user_id) DO UPDATE SET chat_price = 100`, [host.id]);
  const u = await register('penggunagratis');
  await A('POST', `/api/admin/users/${u.id}/coins`, { amount: 1000 });
  await db.query(`UPDATE users SET checkin_cards = 2 WHERE id = $1`, [u.id]);
  const conv = (await api('POST', '/api/conversations', { token: u.token, body: { hostId: host.id } })).body;

  const send = (t) => api('POST', `/api/conversations/${conv.id}/messages`, { token: u.token, body: { body: t } });
  const r1 = await send('halo satu');
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.freeCard, true);
  assert.equal(r1.body.message.freeSource, 'checkin');
  assert.equal(await coins(u), 1000, 'koin tidak terpotong');
  const hostDiamonds = async () => Number((await db.query(`SELECT diamonds FROM users WHERE id = $1`, [host.id])).rows[0].diamonds);
  assert.equal(await hostDiamonds(), 5, 'host menerima 5 diamond dari app');
  assert.equal((await send('halo dua')).body.freeCard, true);
  assert.equal((await myMembership(u)).checkinCards, 0);
  // kredit habis -> pesan berbayar biasa
  const r3 = await send('halo tiga');
  assert.equal(r3.body.freeCard, false);
  assert.equal(await coins(u), 900);
});

test('host tidak bisa check-in; admin mengatur hadiah dengan format yang benar', async () => {
  const h = await register('hostcheckin');
  await A('PATCH', `/api/admin/users/${h.id}/role`, { role: 'host' });
  assert.equal((await api('POST', '/api/checkin/claim', { token: h.token })).status, 403);

  const set = (v) => A('PATCH', '/api/admin/settings', { checkin_rewards: v });
  assert.equal((await set('coins:1,coins:2')).status, 400);
  assert.equal((await set('coins:1,coins:1,coins:1,coins:1,coins:1,coins:1,coins:5000')).status, 400);
  assert.equal((await set('coins:1,coins:1,coins:1,coins:1,coins:1,coins:1,frame:3:3')).status, 400, 'model bingkai hanya 1-2');
  assert.equal((await set('coins:1,coins:1,coins:1,coins:1,coins:1,coins:1,hadiah:9')).status, 400);
  assert.equal((await set('coins:2, cards:3, frame:2:7, coins:2, cards:2, frame:1:1, coins:20')).status, 200);
  const u = await register('checkinempat');
  const st = (await api('GET', '/api/checkin', { token: u.token })).body;
  assert.deepEqual(st.rewards[2], { type: 'frame', frame: 2, days: 7 });
  assert.deepEqual(st.rewards.map((r) => r.type), ['coins', 'cards', 'frame', 'coins', 'cards', 'frame', 'coins']);
  assert.equal((await api('GET', '/api/checkin')).status, 401);
});

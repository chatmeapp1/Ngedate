/**
 * Gift dari host ke pengguna: host bayar diamond (harga/10), pengguna tidak menerima apa pun.
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

const bal = async (id) => { const r = (await db.query(`SELECT coins, diamonds FROM users WHERE id = $1`, [id])).rows[0]; return { coins: Number(r.coins), diamonds: Number(r.diamonds) }; };

test('host mengirim gift: diamond host berkurang harga/10, pengguna tidak dapat koin, tidak masuk hitungan gift', async () => {
  const host = await register('hostgift');
  await api('PATCH', `/api/admin/users/${host.id}/role`, { token: admin, body: { role: 'host' } });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female', diamonds = 1000 WHERE id = $1`, [host.id]);
  const user = await register('penerima');
  const { rows } = await db.query(`INSERT INTO gifts (name, price, icon) VALUES ('Mawar', 10000, '🌹') RETURNING id`);
  const giftId = rows[0].id;
  const conv = (await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } })).body;
  const userBefore = await bal(user.id);

  // pengguna tidak bisa memakai jalur host
  assert.equal((await api('POST', `/api/conversations/${conv.id}/host-gifts`, { token: user.token, body: { giftId } })).status, 403);

  const r = await api('POST', `/api/conversations/${conv.id}/host-gifts`, { token: host.token, body: { giftId, count: 1 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.cost, 1000);
  assert.equal(r.body.message.type, 'gift');
  assert.equal(r.body.message.hostGift, true);
  assert.equal((await bal(host.id)).diamonds, 0);
  assert.deepEqual(await bal(user.id), userBefore, 'pengguna tidak menerima apa pun');

  // diamond tidak cukup
  const poor = await api('POST', `/api/conversations/${conv.id}/host-gifts`, { token: host.token, body: { giftId } });
  assert.equal(poor.status, 402);
  assert.equal(poor.body.error.code, 'INSUFFICIENT_DIAMONDS');
  assert.equal((await bal(host.id)).diamonds, 0);

  // tidak terhitung sebagai gift pengguna
  const gt = (await db.query(`SELECT gift_total FROM conversations WHERE id = $1`, [conv.id])).rows[0].gift_total;
  assert.equal(Number(gt), 0);
  const cnt = (await db.query(`SELECT count(*)::int AS n FROM messages WHERE type = 'gift'`)).rows[0].n;
  assert.equal(cnt, 0);
});

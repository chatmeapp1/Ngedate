/**
 * Permintaan gift dari host: gratis untuk host, pengguna memenuhi dengan koin.
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

test('host meminta gift: gratis, satu permintaan menunggu, pengguna memenuhi -> status selesai & host dibayar normal', async () => {
  const host = await register('hostminta');
  await api('PATCH', `/api/admin/users/${host.id}/role`, { token: admin, body: { role: 'host' } });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [host.id]);
  const user = await register('pemberi');
  await db.query(`UPDATE users SET coins = 50000 WHERE id = $1`, [user.id]);
  const g = (await db.query(`INSERT INTO gifts (name, price, icon) VALUES ('Mawar', 10000, '🌹') RETURNING id`)).rows[0].id;
  const g2 = (await db.query(`INSERT INTO gifts (name, price, icon) VALUES ('Hati', 100, '❤️') RETURNING id`)).rows[0].id;
  const conv = (await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } })).body;

  // host melihat pendapatan diamond per gift, pengguna tidak
  const hg = (await api('GET', '/api/gifts', { token: host.token })).body.find((x) => x.id === g);
  assert.equal(hg.hostIncome, 1000);
  assert.equal((await api('GET', '/api/gifts', { token: user.token })).body.find((x) => x.id === g).hostIncome, undefined);

  // pengguna tidak bisa memakai jalur permintaan
  assert.equal((await api('POST', `/api/conversations/${conv.id}/gift-requests`, { token: user.token, body: { giftId: g } })).status, 403);

  const hostBefore = await bal(host.id);
  const r = await api('POST', `/api/conversations/${conv.id}/gift-requests`, { token: host.token, body: { giftId: g } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.message.type, 'giftreq');
  assert.equal(r.body.message.giftRequest, 'pending');
  assert.equal(r.body.message.gift.id, g);
  assert.deepEqual(await bal(host.id), hostBefore, 'host tidak membayar apa pun');

  // satu permintaan menunggu per percakapan
  const again = await api('POST', `/api/conversations/${conv.id}/gift-requests`, { token: host.token, body: { giftId: g2 } });
  assert.equal(again.status, 429);
  assert.equal(again.body.error.code, 'REQUEST_PENDING');

  // gift lain tidak menutup permintaan; gift yang diminta menutupnya
  const other = await api('POST', `/api/conversations/${conv.id}/gifts`, { token: user.token, body: { giftId: g2, count: 1, requestId: r.body.message.id } });
  assert.equal(other.status, 201);
  assert.equal(other.body.requestId, null);
  const ok = await api('POST', `/api/conversations/${conv.id}/gifts`, { token: user.token, body: { giftId: g, count: 1, requestId: r.body.message.id } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.requestId, r.body.message.id);
  assert.equal((await bal(user.id)).coins, 50000 - 100 - 10000);
  assert.equal((await bal(host.id)).diamonds, hostBefore.diamonds + 10 + 1000);

  const msgs = (await api('GET', `/api/conversations/${conv.id}/messages`, { token: host.token })).body;
  const list = msgs.messages || msgs;
  assert.equal(list.find((m) => m.id === r.body.message.id).giftRequest, 'done');

  // sudah selesai -> boleh meminta lagi; tidak bisa dipenuhi dua kali
  assert.equal((await api('POST', `/api/conversations/${conv.id}/gift-requests`, { token: host.token, body: { giftId: g } })).status, 201);
  const dup = await api('POST', `/api/conversations/${conv.id}/gifts`, { token: user.token, body: { giftId: g, count: 1, requestId: r.body.message.id } });
  assert.equal(dup.body.requestId, null);
});

/**
 * Level, VIP, dan kartu pesan gratis.
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
let buyer;
let host;

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
const me = async (u) => (await api('GET', '/api/me', { token: u.token })).body;
const diamonds = async (id) => Number((await db.query(`SELECT diamonds FROM users WHERE id = $1`, [id])).rows[0].diamonds);
const coins = async (id) => Number((await db.query(`SELECT coins FROM users WHERE id = $1`, [id])).rows[0].coins);

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
  buyer = await register('pembeli');
  host = await register('hostku');
  await A('PATCH', `/api/admin/users/${host.id}/role`, { role: 'host' });
  await api('PATCH', '/api/host/settings', { token: host.token, body: { chatPrice: 100 } });
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('level naik dari total top up; penyesuaian koin tidak dihitung', async () => {
  let m = (await me(buyer)).membership;
  assert.equal(m.level, 0);
  assert.equal(m.vip, 0);
  assert.equal(m.nextLevelAt, 2000);

  await A('POST', `/api/admin/users/${buyer.id}/coins`, { amount: 2000 });
  m = (await me(buyer)).membership;
  assert.equal(m.level, 1);
  assert.equal(m.topupTotal, 2000);
  assert.equal(m.nextLevelAt, 30000);
  assert.ok(Math.abs(m.levelProgress - 0) < 1e-9);

  await A('POST', `/api/admin/users/${buyer.id}/coins`, { amount: 78000 });
  m = (await me(buyer)).membership;
  assert.equal(m.level, 3, '80.000 = Level 3');

  await A('POST', `/api/admin/users/${buyer.id}/coins`, { amount: -50000 }); // dikurangi admin
  assert.equal((await me(buyer)).membership.topupTotal, 80000, 'pengurangan tidak menurunkan level');
});

test('VIP 1-5 mengikuti batas 300rb, 700rb, 1,4 juta, 2,8 juta, 4 juta', async () => {
  const u = await register('kaya');
  const steps = [[299999, 0], [1, 1], [400000, 2], [700000, 3], [1400000, 4], [1200000, 5]];
  // total kumulatif: 299.999, 300.000, 700.000, 1.400.000, 2.800.000, 4.000.000
  for (const [amount, vip] of steps) {
    await A('POST', `/api/admin/users/${u.id}/coins`, { amount });
    assert.equal((await me(u)).membership.vip, vip, `vip ${vip}`);
  }
  const m = (await me(u)).membership;
  assert.equal(m.level, 8, '4 juta koin = Level 8');
  assert.equal(m.nextVipAt, null);
  assert.equal(m.maxVip, 5);
});

test('pengguna biasa membayar pesan; VIP memakai kartu gratis 5x per hari, host dapat 5 diamond', async () => {
  const conv = (await api('POST', '/api/conversations', { token: buyer.token, body: { hostId: host.id } })).body;
  // buyer (total 80.000) bukan VIP -> bayar normal
  const paid = await api('POST', `/api/conversations/${conv.id}/messages`, { token: buyer.token, body: { body: 'halo' } });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.freeCard, false);
  assert.equal(paid.body.message.price, 100);

  const vip = await register('vip1');
  await A('POST', `/api/admin/users/${vip.id}/coins`, { amount: 300000 });
  const vconv = (await api('POST', '/api/conversations', { token: vip.token, body: { hostId: host.id } })).body;
  assert.equal((await me(vip)).membership.freeCardsLeft, 5);

  const coinsBefore = await coins(vip.id);
  const dBefore = await diamonds(host.id);
  for (let i = 1; i <= 5; i++) {
    const r = await api('POST', `/api/conversations/${vconv.id}/messages`, { token: vip.token, body: { body: `pesan ${i}` } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.freeCard, true);
    assert.equal(r.body.message.freeCard, true);
    assert.equal(r.body.message.price, 0);
    assert.equal(r.body.message.paymentStatus, 'free');
  }
  assert.equal(await coins(vip.id), coinsBefore, 'koin VIP tidak berkurang');
  assert.equal(await diamonds(host.id), dBefore + 25, '5 pesan x 5 diamond');
  assert.equal((await me(vip)).membership.freeCardsLeft, 0);

  // pesan ke-6 berbayar seperti biasa
  const sixth = await api('POST', `/api/conversations/${vconv.id}/messages`, { token: vip.token, body: { body: 'pesan 6' } });
  assert.equal(sixth.body.freeCard, false);
  assert.equal(sixth.body.message.price, 100);
  assert.equal(await coins(vip.id), coinsBefore - 100);
  assert.equal(await diamonds(host.id), dBefore + 25, 'pesan berbayar masih ditahan');

  const ledger = await db.query(`SELECT COUNT(*)::int AS n FROM ledger WHERE user_id = $1 AND reason = 'free_card_income'`, [host.id]);
  assert.equal(ledger.rows[0].n, 5);
});

test('kartu gratis tidak berlaku untuk host yang gratis, dan jumlah/diamond dapat diatur admin', async () => {
  const vip = (await db.query(`SELECT id FROM users WHERE username = 'vip1'`)).rows[0];
  void vip;
  const s = await A('PATCH', '/api/admin/settings', { free_cards_per_day: 2, free_card_host_diamonds: 8 });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const v2 = await register('vip2');
  await A('POST', `/api/admin/users/${v2.id}/coins`, { amount: 300000 });
  const conv = (await api('POST', '/api/conversations', { token: v2.token, body: { hostId: host.id } })).body;
  assert.equal((await me(v2)).membership.freeCardsLeft, 2);
  const before = await diamonds(host.id);
  for (let i = 0; i < 3; i++) await api('POST', `/api/conversations/${conv.id}/messages`, { token: v2.token, body: { body: `x${i}` } });
  assert.equal(await diamonds(host.id), before + 16, '2 kartu x 8 diamond');
});

test('batas level & VIP: validasi dan simpan dari panel admin', async () => {
  const ok = await A('PATCH', '/api/admin/settings', { vip_thresholds: '100, 200, 300, 400, 500' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.vip_thresholds, [100, 200, 300, 400, 500]);
  assert.equal((await A('PATCH', '/api/admin/settings', { vip_thresholds: '1,2,3' })).status, 400, 'harus 5 angka');
  assert.equal((await A('PATCH', '/api/admin/settings', { level_thresholds: '5,2000,30000,80000,150000,250000,500000,1000000,2000000,5000000,10000000' })).status, 400, 'level 0 harus 0');
  assert.equal((await A('PATCH', '/api/admin/settings', { vip_thresholds: '500,400,300,200,100' })).status, 400, 'harus menaik');
  await A('PATCH', '/api/admin/settings', { vip_thresholds: '300000, 700000, 1400000, 2800000, 4000000' });
});

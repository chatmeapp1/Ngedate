/**
 * Detail penagihan: filter riwayat koin per bulan, jenis, dan mata uang.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

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

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  server = http.createServer(createApp());
  realtime.attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('riwayat koin bisa difilter per bulan WIB, jenis, dan mata uang', async () => {
  const r = await api('POST', '/api/auth/register', { body: { username: 'penagihan', password: 'rahasia123', displayName: 'P' } });
  const id = r.body.user.id;
  const token = r.body.accessToken;
  const other = (await api('POST', '/api/auth/register', { body: { username: 'lainnya', password: 'rahasia123', displayName: 'L' } })).body.user.id;
  const add = (uid, cur, amount, reason, at) =>
    db.query(`INSERT INTO ledger (user_id, currency, amount, balance_after, reason, created_at) VALUES ($1, $2, $3, 0, $4, $5)`, [uid, cur, amount, reason, at]);
  await add(id, 'coin', 1000, 'admin_topup', '2026-10-31T17:30:00Z'); // 1 Nov 00:30 WIB -> masuk November
  await add(id, 'coin', -100, 'chat_hold', '2026-11-10T03:00:00Z');
  await add(id, 'coin', -50, 'gift_send', '2026-11-12T03:00:00Z');
  await add(id, 'coin', 10, 'checkin', '2026-11-13T03:00:00Z');
  await add(id, 'coin', 100, 'chat_refund', '2026-11-14T03:00:00Z');
  await add(id, 'diamond', 5, 'task_reward', '2026-11-15T03:00:00Z');
  await add(id, 'coin', -20, 'media_unlock', '2026-12-01T03:00:00Z'); // Desember
  await add(other, 'coin', -999, 'gift_send', '2026-11-10T03:00:00Z'); // milik orang lain

  const q = async (qs) => (await api('GET', `/api/wallet/ledger?${qs}`, { token })).body;
  assert.equal((await q('currency=coin&month=2026-11')).length, 5, 'November: batas bulan memakai WIB');
  assert.equal((await q('currency=coin&month=2026-12')).length, 1);
  const spend = await q('currency=coin&month=2026-11&kind=spend');
  assert.deepEqual(spend.map((e) => e.reason).sort(), ['chat_hold', 'gift_send']);
  assert.equal((await q('currency=coin&month=2026-11&kind=topup')).length, 1);
  assert.equal((await q('currency=coin&month=2026-11&kind=reward')).length, 1);
  assert.equal((await q('currency=coin&month=2026-11&kind=refund')).length, 1);
  assert.equal((await q('currency=diamond')).length, 1);
  assert.equal((await q('')).length, 7, 'tanpa filter: semua milik sendiri');
  assert.equal((await api('GET', '/api/wallet/ledger?month=2026-13', { token })).status, 400);
  assert.equal((await api('GET', '/api/wallet/ledger?kind=ngawur', { token })).status, 400);
});

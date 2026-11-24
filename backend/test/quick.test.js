/**
 * Login cepat (akun per perangkat). Database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');

let server;
let base;

async function quick(deviceKey, extra = {}) {
  const res = await fetch(`${base}/api/auth/quick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceKey, ...extra }),
  });
  return { status: res.status, body: await res.json() };
}

const key = () => crypto.randomBytes(32).toString('base64url');

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('perangkat baru mendapat akun baru, perangkat yang sama mendapat akun yang sama', async () => {
  const k = key();
  const first = await quick(k, { countryCode: 'ph' });
  assert.equal(first.status, 201);
  assert.equal(first.body.isNew, true);
  assert.match(first.body.user.username, /^amora\d{8}$/);
  assert.equal(first.body.user.role, 'user');
  assert.equal(first.body.user.countryCode, 'PH');
  assert.ok(first.body.accessToken && first.body.refreshToken);

  const again = await quick(k);
  assert.equal(again.status, 200);
  assert.equal(again.body.isNew, false);
  assert.equal(again.body.user.id, first.body.user.id);

  const other = await quick(key());
  assert.notEqual(other.body.user.id, first.body.user.id);
});

test('device key tidak disimpan mentah di database', async () => {
  const k = key();
  await quick(k);
  const { rows } = await db.query(`SELECT device_hash FROM device_accounts`);
  assert.ok(rows.every((r) => r.device_hash !== k && r.device_hash.length === 64));
});

test('device key pendek / aneh ditolak', async () => {
  assert.equal((await quick('pendek')).status, 400);
  assert.equal((await quick('x'.repeat(40) + "' OR 1=1")).status, 400);
});

test('login bersamaan dari perangkat yang sama tetap satu akun', async () => {
  const k = key();
  const results = await Promise.all(Array.from({ length: 5 }, () => quick(k)));
  results.forEach((r) => assert.ok([200, 201].includes(r.status), JSON.stringify(r.body)));
  const ids = new Set(results.map((r) => r.body.user.id));
  assert.equal(ids.size, 1);
});

test('akun yang di-suspend tidak bisa login cepat', async () => {
  const k = key();
  const r = await quick(k);
  await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [r.body.user.id]);
  const again = await quick(k);
  assert.equal(again.status, 403);
});

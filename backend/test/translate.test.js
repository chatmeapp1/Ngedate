/**
 * Terjemahan teks (tombol Terjemah): cache, batas, bahasa tidak didukung, gagal.
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

const translate = require('../src/services/translate');

const fakeFetch = (calls, impl) => async (url) => {
  calls.push(url);
  return impl(url);
};
const googleReply = (result, from) => ({ ok: true, status: 200, json: async () => [[[result, 'asli', null, null, 1]], null, from] });

test('menerjemahkan lewat penyedia, hasil di-cache, teks sama tidak memanggil penyedia lagi', async () => {
  const u = await register('penerjemah');
  const calls = [];
  translate.setFetch(fakeFetch(calls, (url) => googleReply(/tl=en/.test(url) ? 'Hello, how are you?' : 'Halo', 'id')));

  const r1 = await api('POST', '/api/translate', { token: u.token, body: { text: 'Halo, apa kabar?', to: 'en' } });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.deepEqual([r1.body.text, r1.body.from, r1.body.cached, r1.body.same], ['Hello, how are you?', 'id', false, false]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /tl=en/);
  assert.match(calls[0], /q=Halo%2C%20apa%20kabar%3F/);

  const r2 = await api('POST', '/api/translate', { token: u.token, body: { text: 'Halo, apa kabar?', to: 'en' } });
  assert.equal(r2.body.cached, true);
  assert.equal(calls.length, 1, 'cache: penyedia tidak dipanggil lagi');

  // bahasa tujuan lain = hasil terpisah
  const r3 = await api('POST', '/api/translate', { token: u.token, body: { text: 'Halo, apa kabar?', to: 'zh' } });
  assert.equal(r3.status, 200);
  assert.match(calls[1], /tl=zh-CN/);

  // sudah dalam bahasa tujuan -> same
  translate.setFetch(fakeFetch(calls, () => googleReply('Hello', 'en')));
  const r4 = await api('POST', '/api/translate', { token: u.token, body: { text: 'Hello', to: 'en' } });
  assert.equal(r4.body.same, true);
});

test('validasi: teks kosong/terlalu panjang, bahasa tidak dikenal, wajib login', async () => {
  const u = await register('penerjemah2');
  translate.setFetch(fakeFetch([], () => googleReply('x', 'id')));
  assert.equal((await api('POST', '/api/translate', { token: u.token, body: { text: '  ', to: 'en' } })).status, 400);
  assert.equal((await api('POST', '/api/translate', { token: u.token, body: { text: 'a'.repeat(1001), to: 'en' } })).status, 400);
  assert.equal((await api('POST', '/api/translate', { token: u.token, body: { text: 'halo', to: 'xx' } })).status, 400);
  assert.equal((await api('POST', '/api/translate', { body: { text: 'halo', to: 'en' } })).status, 401);
});

test('penyedia gagal = 502 yang ramah dan tidak di-cache; batas permintaan per pengguna', async () => {
  const u = await register('penerjemah3');
  translate.resetLimits();
  translate.setFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  const bad = await api('POST', '/api/translate', { token: u.token, body: { text: 'gagal ya', to: 'en' } });
  assert.equal(bad.status, 502);
  assert.equal(bad.body.error.code, 'TRANSLATE_FAILED');
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM translation_cache WHERE result = 'gagal ya'`)).rows[0].n, 0);

  translate.resetLimits();
  let n = 0;
  translate.setFetch(async () => googleReply('ok ' + n++, 'id'));
  let last;
  for (let i = 0; i < 81; i++) last = await api('POST', '/api/translate', { token: u.token, body: { text: 'teks unik ' + i, to: 'en' } });
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'TRANSLATE_LIMIT');
});

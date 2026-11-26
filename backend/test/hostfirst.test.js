/**
 * Host menyapa duluan (gratis); koin user baru dibayarkan saat host membalas.
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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(username) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.user.id, token: r.body.accessToken };
}

async function balance(id) {
  const { rows } = await db.query(`SELECT coins, diamonds FROM users WHERE id = $1`, [id]);
  return { coins: Number(rows[0].coins), diamonds: Number(rows[0].diamonds) };
}

let host, budi, wanita, host2;
let convId;

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  server = http.createServer(createApp());
  realtime.attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  host = await register('sari');
  host2 = await register('dewi');
  for (const h of [host, host2]) {
    await db.query(`UPDATE users SET role = 'host', host_status = 'approved', gender = 'female', profile_completed = true WHERE id = $1`, [h.id]);
    await db.query(`INSERT INTO host_profiles (user_id, chat_price) VALUES ($1, 100)`, [h.id]);
  }
  budi = await register('budi');
  await db.query(`UPDATE users SET gender = 'male', profile_completed = true, coins = 1000 WHERE id = $1`, [budi.id]);
  wanita = await register('wanita');
  await db.query(`UPDATE users SET gender = 'female', profile_completed = true WHERE id = $1`, [wanita.id]);
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('host bisa membuka percakapan dengan pengguna pria, bukan wanita atau host lain', async () => {
  const r = await api('POST', '/api/conversations', { token: host.token, body: { userId: budi.id } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.role, 'host');
  assert.equal(r.body.peer.id, budi.id);
  convId = r.body.id;

  const again = await api('POST', '/api/conversations', { token: host.token, body: { userId: budi.id } });
  assert.equal(again.body.id, convId, 'percakapan yang sama dipakai ulang');

  assert.equal((await api('POST', '/api/conversations', { token: host.token, body: { userId: wanita.id } })).status, 404);
  assert.equal((await api('POST', '/api/conversations', { token: host.token, body: { userId: host2.id } })).status, 404);
  assert.equal((await api('POST', '/api/conversations', { token: budi.token, body: { userId: wanita.id } })).status, 403, 'user biasa tidak boleh memakai jalur host');
});

test('sapaan host gratis; pesan balasan user ditahan; koin pindah saat host membalas lagi', async () => {
  const hi = await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'Halo, lagi apa?' } });
  assert.equal(hi.status, 201, JSON.stringify(hi.body));
  assert.equal(hi.body.message.paymentStatus, 'free');
  assert.equal(hi.body.message.price, 0);
  assert.deepEqual(await balance(budi.id), { coins: 1000, diamonds: 0 }, 'user belum dipotong apa pun');
  assert.equal((await balance(host.id)).diamonds, 0);

  // Percakapan muncul di daftar user dengan lencana belum dibaca
  const list = await api('GET', '/api/conversations', { token: budi.token });
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].unread, 1);
  assert.equal(list.body[0].peer.id, host.id);

  // User membalas: koin ditahan
  const reply = await api('POST', `/api/conversations/${convId}/messages`, { token: budi.token, body: { body: 'Lagi santai kak' } });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.message.paymentStatus, 'held');
  assert.deepEqual(await balance(budi.id), { coins: 900, diamonds: 0 });
  assert.equal((await balance(host.id)).diamonds, 0, 'host belum dapat sebelum membalas');

  // Host membalas: koin dibayarkan
  const back = await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'Asik, ngobrol yuk' } });
  assert.equal(back.status, 201);
  assert.equal(back.body.settled.coins, 100);
  assert.ok((await balance(host.id)).diamonds > 0, 'host dapat penghasilan');
});

test('host dibatasi 3 pesan beruntun tanpa balasan user', async () => {
  // Setelah balasan terakhir host (di tes sebelumnya) ada 1 pesan host sejak pesan user terakhir
  const a = await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'Kamu dimana?' } });
  assert.equal(a.status, 201);
  const b = await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'Halo?' } });
  assert.equal(b.status, 201);
  const c = await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'Kok diam?' } });
  assert.equal(c.status, 429);
  assert.equal(c.body.error.code, 'WAIT_FOR_REPLY');

  // Setelah user membalas, host bisa kirim lagi
  assert.equal((await api('POST', `/api/conversations/${convId}/messages`, { token: budi.token, body: { body: 'Maaf baru lihat' } })).status, 201);
  assert.equal((await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'Gapapa' } })).status, 201);
});

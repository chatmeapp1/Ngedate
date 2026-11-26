/**
 * Blokir & laporan.
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
let admin, budi, sari, dewi, joko;
let giftId;

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

const coins = async (id) => Number((await db.query(`SELECT coins FROM users WHERE id = $1`, [id])).rows[0].coins);

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  const hash = await bcrypt.hash('admin123', 4);
  await db.query(`INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', $1, 'Admin', 'admin')`, [hash]);
  giftId = (await db.query(`INSERT INTO gifts (name, price, icon) VALUES ('Mawar', 10, '🌹') RETURNING id`)).rows[0].id;

  server = http.createServer(createApp());
  realtime.attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } });
  admin = { id: login.body.user.id, token: login.body.accessToken };

  budi = await register('budi');
  sari = await register('sari');
  dewi = await register('dewi');
  joko = await register('joko');
  await db.query(`UPDATE users SET gender = 'male', profile_completed = true, coins = 10000 WHERE id IN ($1, $2)`, [budi.id, joko.id]);
  for (const h of [sari, dewi]) {
    await db.query(`UPDATE users SET role = 'host', host_status = 'approved', gender = 'female', profile_completed = true WHERE id = $1`, [h.id]);
    await db.query(`INSERT INTO host_profiles (user_id, chat_price) VALUES ($1, 100)`, [h.id]);
  }
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

let convId;

test('blokir: koin tertahan dikembalikan, saling menghilang dari daftar & profil', async () => {
  convId = (await api('POST', '/api/conversations', { token: budi.token, body: { hostId: sari.id } })).body.id;
  assert.equal((await api('POST', `/api/conversations/${convId}/messages`, { token: budi.token, body: { body: 'Halo kak' } })).status, 201);
  assert.equal(await coins(budi.id), 9900, 'koin ditahan');

  const bad = await api('POST', '/api/blocks', { token: budi.token, body: { userId: admin.id } });
  assert.equal(bad.status, 403, 'admin tidak bisa diblokir');
  assert.equal((await api('POST', '/api/blocks', { token: budi.token, body: { userId: budi.id } })).status, 400);
  assert.equal((await api('POST', '/api/blocks', { token: budi.token, body: { userId: 999999 } })).status, 404);

  const r = await api('POST', '/api/blocks', { token: budi.token, body: { userId: sari.id } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.refunded, 100);
  assert.equal(await coins(budi.id), 10000, 'koin kembali penuh');
  // memblokir dua kali tidak error dan tidak mengembalikan lagi
  assert.equal((await api('POST', '/api/blocks', { token: budi.token, body: { userId: sari.id } })).body.refunded, 0);

  // Budi tidak melihat Sari di daftar host, profilnya, maupun percakapan
  const hosts = await api('GET', '/api/hosts', { token: budi.token });
  assert.deepEqual(hosts.body.map((h) => h.username).sort(), ['dewi']);
  assert.equal((await api('GET', `/api/hosts/${sari.id}`, { token: budi.token })).status, 404);
  assert.equal((await api('GET', '/api/conversations', { token: budi.token })).body.length, 0);
  assert.equal((await api('GET', `/api/conversations/${convId}`, { token: budi.token })).status, 404);

  // Sebaliknya: Sari tidak melihat Budi
  const members = await api('GET', '/api/members', { token: sari.token });
  assert.ok(!members.body.some((m) => m.username === 'budi'));
  assert.ok(members.body.some((m) => m.username === 'joko'));
  assert.equal((await api('GET', `/api/members/${budi.id}`, { token: sari.token })).status, 404);
  assert.equal((await api('GET', '/api/conversations', { token: sari.token })).body.length, 0);

  // Pesan & gift ditolak dari dua arah
  const fromBudi = await api('POST', `/api/conversations/${convId}/messages`, { token: budi.token, body: { body: 'Hai' } });
  assert.equal(fromBudi.status, 403);
  assert.equal(fromBudi.body.error.code, 'BLOCKED');
  assert.match(fromBudi.body.error.message, /memblokir/);
  const fromSari = await api('POST', `/api/conversations/${convId}/messages`, { token: sari.token, body: { body: 'Hai juga' } });
  assert.equal(fromSari.status, 403);
  assert.doesNotMatch(fromSari.body.error.message, /memblokir/, 'pihak yang diblokir tidak diberi tahu');
  const gift = await api('POST', `/api/conversations/${convId}/gifts`, { token: budi.token, body: { giftId } });
  assert.equal(gift.status, 403);
  assert.equal(await coins(budi.id), 10000, 'gift ditolak tanpa memotong koin');
  assert.equal((await api('POST', '/api/conversations', { token: budi.token, body: { hostId: sari.id } })).status, 403);
  assert.equal((await api('POST', '/api/conversations', { token: sari.token, body: { userId: budi.id } })).status, 403);
});

test('daftar yang diblokir & buka blokir mengembalikan semuanya', async () => {
  const list = await api('GET', '/api/blocks', { token: budi.token });
  assert.deepEqual(list.body.map((u) => u.username), ['sari']);
  // yang memblokir yang melihat daftar; yang diblokir tidak
  assert.equal((await api('GET', '/api/blocks', { token: sari.token })).body.length, 0);

  assert.equal((await api('DELETE', `/api/blocks/${sari.id}`, { token: budi.token })).status, 200);
  assert.equal((await api('GET', '/api/blocks', { token: budi.token })).body.length, 0);

  const hosts = await api('GET', '/api/hosts', { token: budi.token });
  assert.deepEqual(hosts.body.map((h) => h.username).sort(), ['dewi', 'sari']);
  assert.equal((await api('GET', `/api/hosts/${sari.id}`, { token: budi.token })).status, 200);
  assert.equal((await api('GET', '/api/conversations', { token: budi.token })).body.length, 1);
  assert.equal((await api('POST', `/api/conversations/${convId}/messages`, { token: budi.token, body: { body: 'Sudah baikan' } })).status, 201);
  // Host yang memblokir user: user juga tidak bisa mengirim, koin tidak terpotong
  assert.equal(await coins(budi.id), 9900, 'pesan baru ditahan');
  await api('POST', '/api/blocks', { token: sari.token, body: { userId: budi.id } });
  assert.equal(await coins(budi.id), 10000, 'pesan tertahan dikembalikan saat host memblokir');
  const sent = await api('POST', `/api/conversations/${convId}/messages`, { token: budi.token, body: { body: 'Halo?' } });
  assert.equal(sent.status, 403);
  assert.equal(await coins(budi.id), 10000, 'pesan ditolak tanpa memotong koin');
  await api('DELETE', `/api/blocks/${budi.id}`, { token: sari.token });
});

test('laporan: bukti chat tersimpan, tidak ganda, alasan harus valid, batas harian', async () => {
  const reasons = await api('GET', '/api/reports/reasons', { token: budi.token });
  assert.ok(reasons.body.some((r) => r.key === 'scam'));

  assert.equal((await api('POST', '/api/reports', { token: budi.token, body: { targetId: sari.id, reason: 'bukan-alasan' } })).status, 400);
  assert.equal((await api('POST', '/api/reports', { token: budi.token, body: { targetId: budi.id, reason: 'spam' } })).status, 400);
  assert.equal((await api('POST', '/api/reports', { token: budi.token, body: { targetId: admin.id, reason: 'spam' } })).status, 403);
  assert.equal((await api('POST', '/api/reports', { token: budi.token, body: { targetId: 999999, reason: 'spam' } })).status, 404);
  // percakapan milik orang lain / bukan dengan terlapor
  assert.equal((await api('POST', '/api/reports', { token: joko.token, body: { targetId: sari.id, reason: 'spam', conversationId: convId } })).status, 404);
  assert.equal((await api('POST', '/api/reports', { token: budi.token, body: { targetId: dewi.id, reason: 'spam', conversationId: convId } })).status, 400);

  const r1 = await api('POST', '/api/reports', {
    token: budi.token,
    body: { targetId: sari.id, reason: 'scam', details: 'Minta transfer', conversationId: convId },
  });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.duplicate, false);
  const dup = await api('POST', '/api/reports', { token: budi.token, body: { targetId: sari.id, reason: 'spam' } });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicate, true);

  // batas harian: 10 laporan ke target berbeda
  const spammer = await register('pelapor');
  for (let i = 0; i < 10; i++) {
    const t = await register(`target${i}`);
    assert.equal((await api('POST', '/api/reports', { token: spammer.token, body: { targetId: t.id, reason: 'spam' } })).status, 201, `laporan ${i}`);
  }
  const extra = await register('targetx');
  const limited = await api('POST', '/api/reports', { token: spammer.token, body: { targetId: extra.id, reason: 'spam' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'TOO_MANY_REPORTS');
});

test('admin meninjau laporan: bukti terlihat, abaikan / tangguhkan akun', async () => {
  assert.equal((await api('GET', '/api/admin/reports', { token: budi.token })).status, 403);

  const list = await api('GET', '/api/admin/reports?status=pending', { token: admin.token });
  assert.equal(list.status, 200);
  const rep = list.body.find((r) => r.target.username === 'sari');
  assert.ok(rep);
  assert.equal(rep.reason, 'scam');
  assert.equal(rep.reasonLabel, 'Penipuan / minta uang');
  assert.equal(rep.reporter.username, 'budi');
  assert.equal(rep.target.totalReports, 1);
  assert.ok(rep.evidence.length >= 2, 'bukti pesan tersimpan');
  assert.ok(rep.evidence.some((m) => m.body === 'Halo kak' && m.from === 'pelapor'));

  const stats = await api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(stats.body.pending.reports, list.body.length);

  // abaikan laporan lain
  const other = list.body.find((r) => r.target.username === 'target0');
  assert.equal((await api('POST', `/api/admin/reports/${other.id}/review`, { token: admin.token, body: { decision: 'dismiss', note: 'Tidak melanggar' } })).status, 200);
  assert.equal((await api('POST', `/api/admin/reports/${other.id}/review`, { token: admin.token, body: { decision: 'dismiss' } })).status, 404, 'tidak bisa ditinjau dua kali');
  assert.equal((await api('POST', `/api/admin/reports/${rep.id}/review`, { token: admin.token, body: { decision: 'ngawur' } })).status, 400);

  // laporan kedua terhadap Sari dari orang lain, lalu tangguhkan
  await api('POST', '/api/reports', { token: joko.token, body: { targetId: sari.id, reason: 'harassment' } });
  const sus = await api('POST', `/api/admin/reports/${rep.id}/review`, { token: admin.token, body: { decision: 'suspend', note: 'Terbukti' } });
  assert.equal(sus.status, 200);
  const sariRow = (await db.query(`SELECT status FROM users WHERE id = $1`, [sari.id])).rows[0];
  assert.equal(sariRow.status, 'suspended');
  const left = await api('GET', '/api/admin/reports?status=pending', { token: admin.token });
  assert.ok(!left.body.some((r) => r.target.username === 'sari'), 'laporan lain terhadap akun itu ikut selesai');
  const done = await api('GET', '/api/admin/reports?status=resolved', { token: admin.token });
  assert.equal(done.body.filter((r) => r.target.username === 'sari').length, 2);
  assert.equal((await api('GET', '/api/admin/reports?status=dismissed', { token: admin.token })).body.length, 1);
});

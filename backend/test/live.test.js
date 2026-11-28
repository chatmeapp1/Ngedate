/**
 * Live stream tahap 1: siklus siaran, auth media server, sinkron status, obrolan live, moderasi.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LIVE_MEDIA_API = ''; // jangan sinkron ke media server sungguhan
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');
const live = require('../src/services/live');

let server;
let base;
let admin;

async function api(method, p, { token, body, headers } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

async function makeHost(name, verified = true) {
  const h = await register(name);
  await api('PATCH', `/api/admin/users/${h.id}/role`, { token: admin, body: { role: 'host' } });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female', verified = $2 WHERE id = $1`, [h.id, verified]);
  return h;
}
const mediaAuth = (b, headers) => api('POST', '/api/live-media/auth', { body: b, headers });
const secretOf = (info) => info.streamKey.split('pass=')[1];

test('hanya host terverifikasi yang bisa memulai live; memulai ulang memutar kunci siaran', async () => {
  const user = await register('penonton1');
  assert.equal((await api('POST', '/api/live/start', { token: user.token, body: {} })).status, 403);
  const unverified = await makeHost('hostbelum', false);
  const nv = await api('POST', '/api/live/start', { token: unverified.token, body: {} });
  assert.equal(nv.status, 403);
  assert.equal(nv.body.error.code, 'NOT_VERIFIED');

  const host = await makeHost('hostlive');
  const a = await api('POST', '/api/live/start', { token: host.token, body: { title: 'Ngobrol santai' } });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.match(a.body.publicId, /^[a-f0-9]{16}$/);
  assert.match(a.body.streamKey, /^[a-f0-9]{16}\?user=live&pass=[a-f0-9]{24}$/);
  assert.equal(a.body.status, 'waiting');
  const b = await api('POST', '/api/live/start', { token: host.token, body: { title: 'Judul baru' } });
  assert.equal(b.body.id, a.body.id, 'masih satu siaran');
  assert.notEqual(secretOf(b.body), secretOf(a.body), 'kunci diputar');
  // judul berisi nomor ditolak
  assert.equal((await api('POST', '/api/live/start', { token: host.token, body: { title: 'wa 081234567890' } })).status, 422);
  const mine = (await api('GET', '/api/live/mine', { token: host.token })).body.current;
  assert.equal(mine.status, 'waiting');
  assert.equal((await api('GET', '/api/live/mine', { token: user.token })).status, 403);
  await live.endByHost(host.id, a.body.id);
});

test('auth media server: publish butuh kunci benar, hanya dari localhost, path harus sah', async () => {
  const host = await makeHost('hostauth');
  const info = (await api('POST', '/api/live/start', { token: host.token, body: {} })).body;
  const path = `live/${info.publicId}`;
  const good = { action: 'publish', path, query: `user=live&pass=${secretOf(info)}` };
  assert.equal((await mediaAuth(good)).status, 200);
  assert.equal((await mediaAuth({ ...good, query: 'user=live&pass=salah' })).status, 401);
  assert.equal((await mediaAuth({ action: 'publish', path, query: '' })).status, 401);
  assert.equal((await mediaAuth({ action: 'read', path })).status, 200, 'penonton boleh membaca siaran aktif');
  assert.equal((await mediaAuth({ action: 'read', path: 'live/0123456789abcdef' })).status, 401, 'siaran tidak ada');
  assert.equal((await mediaAuth({ action: 'publish', path: 'lain/abc', query: good.query })).status, 401, 'path tidak sah');
  assert.equal((await mediaAuth({ action: 'api', path })).status, 401);
  assert.equal((await mediaAuth(good, { 'x-forwarded-for': '1.2.3.4' })).status, 403, 'lewat proxy publik ditolak');
  await live.endByHost(host.id, info.id);
  assert.equal((await mediaAuth({ action: 'read', path })).status, 401, 'siaran berakhir tidak bisa dibaca/publish');
  assert.equal((await mediaAuth(good)).status, 401);
});

test('sinkron: waiting -> live saat publisher siap, terputus lama berakhir, menunggu terlalu lama berakhir', async () => {
  const host = await makeHost('hostsync');
  const info = (await api('POST', '/api/live/start', { token: host.token, body: { title: 'Sync' } })).body;
  const viewer = await register('penontonsync');
  assert.equal((await api('GET', '/api/live', { token: viewer.token })).body.length, 0, 'belum live tidak tampil di daftar');

  await live.syncFromPaths([{ name: `live/${info.publicId}`, ready: true }]);
  const list = (await api('GET', '/api/live', { token: viewer.token })).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Sync');
  assert.equal(list[0].host.id, host.id);
  const d = (await api('GET', `/api/live/${info.id}`, { token: viewer.token })).body;
  assert.equal(d.status, 'live');
  assert.equal(d.playbackUrl, `/live-hls/live/${info.publicId}/index.m3u8`);
  assert.equal((await api('POST', '/api/live/start', { token: host.token, body: {} })).status, 409, 'siaran live tidak bisa dimulai lagi');

  // terputus: ditandai dulu, belum berakhir
  await live.syncFromPaths([]);
  let row = (await db.query(`SELECT status, disconnected_at FROM live_streams WHERE id = $1`, [info.id])).rows[0];
  assert.equal(row.status, 'live');
  assert.ok(row.disconnected_at);
  // tersambung lagi sebelum batas: kembali normal
  await live.syncFromPaths([{ name: `live/${info.publicId}`, ready: true }]);
  row = (await db.query(`SELECT status, disconnected_at FROM live_streams WHERE id = $1`, [info.id])).rows[0];
  assert.equal(row.disconnected_at, null);
  // terputus melewati batas: berakhir
  await live.syncFromPaths([]);
  await db.query(`UPDATE live_streams SET disconnected_at = now() - interval '2 minutes' WHERE id = $1`, [info.id]);
  await live.syncFromPaths([]);
  row = (await db.query(`SELECT status, ended_reason FROM live_streams WHERE id = $1`, [info.id])).rows[0];
  assert.deepEqual([row.status, row.ended_reason], ['ended', 'dropped']);

  // menunggu terlalu lama tanpa publisher
  const w = (await api('POST', '/api/live/start', { token: host.token, body: {} })).body;
  await db.query(`UPDATE live_streams SET created_at = now() - interval '20 minutes' WHERE id = $1`, [w.id]);
  await live.syncFromPaths([]);
  assert.equal((await db.query(`SELECT ended_reason FROM live_streams WHERE id = $1`, [w.id])).rows[0].ended_reason, 'timeout');
});

test('obrolan live: hanya saat live, filter kontak, batas kecepatan, blokir, dan riwayat untuk yang baru masuk', async () => {
  const host = await makeHost('hostchat');
  const viewer = await register('penontonchat');
  const blocked = await register('penontondiblokir');
  const info = (await api('POST', '/api/live/start', { token: host.token, body: {} })).body;
  assert.equal((await api('POST', `/api/live/${info.id}/chat`, { token: viewer.token, body: { body: 'halo' } })).status, 409, 'belum live');
  await live.syncFromPaths([{ name: `live/${info.publicId}`, ready: true }]);

  const ok = await api('POST', `/api/live/${info.id}/chat`, { token: viewer.token, body: { body: 'Halo kak, semangat!' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.message.user.id, viewer.id);
  assert.equal(ok.body.message.user.isHost, false);
  assert.equal((await api('POST', `/api/live/${info.id}/chat`, { token: viewer.token, body: { body: 'lagi' } })).status, 429, 'terlalu cepat');
  assert.equal((await api('POST', `/api/live/${info.id}/chat`, { token: blocked.token, body: { body: 'wa 081234567890' } })).status, 422, 'nomor ditolak');
  assert.equal((await api('POST', `/api/live/${info.id}/chat`, { token: blocked.token, body: { body: '' } })).status, 400);
  assert.equal((await api('POST', `/api/live/${info.id}/chat`, { token: blocked.token, body: { body: 'x'.repeat(201) } })).status, 400);
  const hostMsg = await api('POST', `/api/live/${info.id}/chat`, { token: host.token, body: { body: 'Terima kasih sudah mampir' } });
  assert.equal(hostMsg.body.message.user.isHost, true);

  const d = (await api('GET', `/api/live/${info.id}`, { token: blocked.token })).body;
  assert.deepEqual(d.chat.map((m) => m.body), ['Halo kak, semangat!', 'Terima kasih sudah mampir']);

  // host memblokir pengguna: siaran tidak terlihat & tidak bisa chat
  assert.equal((await api('POST', '/api/blocks', { token: host.token, body: { userId: blocked.id } })).status < 300, true);
  assert.equal((await api('GET', `/api/live/${info.id}`, { token: blocked.token })).status, 404);
  assert.equal((await api('POST', `/api/live/${info.id}/chat`, { token: blocked.token, body: { body: 'halo' } })).status, 404);
  assert.equal((await api('GET', '/api/live', { token: blocked.token })).body.length, 0, 'daftar live menyembunyikan host yang memblokir');
  assert.equal((await api('GET', '/api/live', { token: viewer.token })).body.length, 1);
  await live.endByHost(host.id, info.id);
});

test('mengakhiri siaran: host sendiri, admin; host lain tidak bisa; setelah berakhir bisa mulai lagi', async () => {
  const host = await makeHost('hostakhir');
  const other = await makeHost('hostlain');
  const info = (await api('POST', '/api/live/start', { token: host.token, body: {} })).body;
  await live.syncFromPaths([{ name: `live/${info.publicId}`, ready: true }]);
  assert.equal((await api('POST', `/api/live/${info.id}/end`, { token: other.token })).status, 404, 'bukan siaran host lain');

  // admin melihat siaran aktif dan menghentikannya
  const list = (await api('GET', '/api/admin/live', { token: admin })).body;
  const row = list.find((x) => x.id === info.id);
  assert.equal(row.status, 'live');
  assert.equal(row.hostName, 'hostakhir');
  assert.equal((await api('GET', '/api/admin/live', { token: host.token })).status, 403, 'hanya admin');
  assert.equal((await api('POST', `/api/admin/live/${info.id}/end`, { token: admin })).status, 200);
  const after = (await db.query(`SELECT status, ended_reason FROM live_streams WHERE id = $1`, [info.id])).rows[0];
  assert.deepEqual([after.status, after.ended_reason], ['ended', 'admin']);
  assert.equal((await api('POST', `/api/admin/live/${info.id}/end`, { token: admin })).status, 404, 'sudah berakhir');
  assert.equal((await api('GET', `/api/live/${info.id}`, { token: host.token })).body.playbackUrl, null);

  const again = await api('POST', '/api/live/start', { token: host.token, body: {} });
  assert.equal(again.status, 201);
  assert.notEqual(again.body.id, info.id, 'siaran baru');
  assert.equal((await api('POST', `/api/live/${again.body.id}/end`, { token: host.token })).status, 200);
});

test('media server (tiruan): syncOnce membaca daftar path, proxy HLS meneruskan playlist, akhir siaran menendang publisher', async () => {
  const config = require('../src/config');
  const host = await makeHost('hostmedia');
  const info = (await api('POST', '/api/live/start', { token: host.token, body: {} })).body;

  let ready = false;
  const kicked = [];
  const fake = http.createServer((req, res) => {
    if (req.url.startsWith('/v3/paths/list')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ items: ready ? [{ name: `live/${info.publicId}`, ready: true }] : [] }));
    }
    if (req.url === `/v3/paths/get/live/${info.publicId}`) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ source: { type: 'rtmpConn', id: 'conn-1' } }));
    }
    if (req.url === '/v3/rtmpconns/kick/conn-1' && req.method === 'POST') {
      kicked.push('conn-1');
      return res.end('{}');
    }
    if (req.url === `/live/${info.publicId}/index.m3u8?_HLS_msn=3`) {
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      return res.end('#EXTM3U\n#EXT-X-VERSION:9\n');
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const port = fake.address().port;
  const prev = [config.liveMediaApi, config.liveHlsUpstream];
  config.liveMediaApi = `http://127.0.0.1:${port}`;
  config.liveHlsUpstream = `http://127.0.0.1:${port}`;
  try {
    await live.syncOnce();
    assert.equal((await db.query(`SELECT status FROM live_streams WHERE id = $1`, [info.id])).rows[0].status, 'waiting', 'publisher belum siap');
    ready = true;
    await live.syncOnce();
    assert.equal((await db.query(`SELECT status FROM live_streams WHERE id = $1`, [info.id])).rows[0].status, 'live');

    const ok = await fetch(`${base}/live-hls/live/${info.publicId}/index.m3u8?_HLS_msn=3`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /mpegurl/);
    assert.match(await ok.text(), /^#EXTM3U/);
    assert.equal((await fetch(`${base}/live-hls/live/${info.publicId}/hilang.m3u8`)).status, 404, 'status dari media server diteruskan');
    assert.equal((await fetch(`${base}/live-hls/live/../etc/passwd`)).status, 404);
    assert.equal((await fetch(`${base}/live-hls/live/zzzz/index.m3u8`)).status, 404, 'id tidak sah ditolak sebelum diteruskan');

    // API media server mati: siaran tidak ikut diakhiri
    config.liveMediaApi = 'http://127.0.0.1:1';
    await live.syncOnce();
    assert.equal((await db.query(`SELECT status FROM live_streams WHERE id = $1`, [info.id])).rows[0].status, 'live');
    config.liveMediaApi = `http://127.0.0.1:${port}`;

    await live.endByHost(host.id, info.id);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(kicked, ['conn-1'], 'publisher ditendang saat siaran berakhir');
  } finally {
    [config.liveMediaApi, config.liveHlsUpstream] = prev;
    await new Promise((r) => fake.close(r));
  }
});

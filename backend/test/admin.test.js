/**
 * Panel admin: statistik, filter pengguna, unggah gambar, hapus gambar gift, halaman statis.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amora-admin-'));
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');

let server;
let base;
let admin, budi, sari;

async function api(method, p, { token, body, form } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + p, { method, headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(username) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.user.id, token: r.body.accessToken };
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
  const login = await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } });
  assert.equal(login.body.user.role, 'admin');
  admin = { token: login.body.accessToken };
  budi = await register('budi');
  sari = await register('sari');
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved' WHERE id = $1`, [sari.id]);
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('halaman panel admin disajikan tanpa login, API tetap butuh admin', async () => {
  for (const f of ['', 'admin.js', 'admin.css']) {
    const res = await fetch(`${base}/admin/${f}`);
    assert.equal(res.status, 200, f);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await api('GET', '/api/admin/stats')).status, 401);
  assert.equal((await api('GET', '/api/admin/stats', { token: budi.token })).status, 403);
});

test('statistik dashboard menghitung antrean tinjauan dan aktivitas', async () => {
  const r = await api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.users.user, 1);
  assert.equal(r.body.users.host, 1);
  assert.deepEqual(r.body.pending, { verifications: 0, photos: 0, avatars: 0, reports: 0 });
  assert.equal(r.body.newUsers24h, 3);
  assert.equal(r.body.messages24h, 0);

  await db.query(`UPDATE users SET pending_avatar_url = 'http://x/uploads/a.jpg' WHERE id = $1`, [sari.id]);
  const again = await api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(again.body.pending.avatars, 1);
});

test('daftar pengguna bisa disaring peran & status', async () => {
  const hosts = await api('GET', '/api/admin/users?role=host', { token: admin.token });
  assert.deepEqual(hosts.body.map((u) => u.username), ['sari']);
  await api('PATCH', `/api/admin/users/${budi.id}/status`, { token: admin.token, body: { status: 'suspended' } });
  const sus = await api('GET', '/api/admin/users?status=suspended', { token: admin.token });
  assert.deepEqual(sus.body.map((u) => u.username), ['budi']);
  const both = await api('GET', '/api/admin/users?role=host&status=suspended', { token: admin.token });
  assert.equal(both.body.length, 0);
  assert.equal((await api('GET', '/api/admin/users?role=bukan', { token: admin.token })).status, 400);

  // Cari berdasarkan ID persis, bukan hanya nama
  const byId = await api('GET', `/api/admin/users?q=${sari.id}`, { token: admin.token });
  assert.ok(byId.body.some((u) => u.id === sari.id), 'ID ditemukan');
});

test('unggah gambar gift lalu hapus gambarnya', async () => {
  // PNG 1x1 valid
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'g.png');
  const up = await api('POST', '/api/admin/upload', { token: admin.token, form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.match(up.body.url, /\/uploads\/.+\.png$/);
  const file = await fetch(up.body.url.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(file.status, 200);

  // bukan gambar ditolak
  const bad = new FormData();
  bad.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  assert.equal((await api('POST', '/api/admin/upload', { token: admin.token, form: bad })).status, 400);
  assert.equal((await api('POST', '/api/admin/upload', { token: budi.token, form })).status, 403);

  const g = await api('POST', '/api/admin/gifts', { token: admin.token, body: { name: 'Bunga', price: 50, icon: '🌸', imageUrl: up.body.url } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.equal(g.body.imageUrl, up.body.url);
  const cleared = await api('PATCH', `/api/admin/gifts/${g.body.id}`, { token: admin.token, body: { imageUrl: '' } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.imageUrl, null);
  assert.equal(cleared.body.icon, '🌸', 'emoji tetap ada');
});

test('top up koin oleh admin tercatat di riwayat, bisa dikurangi, tidak boleh minus', async () => {
  const up = await api('POST', `/api/admin/users/${budi.id}/coins`, { token: admin.token, body: { amount: 5000, note: 'Top up uji' } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.coins, 5000);
  const down = await api('POST', `/api/admin/users/${budi.id}/coins`, { token: admin.token, body: { amount: -1200, note: 'Koreksi' } });
  assert.equal(down.body.coins, 3800);
  const tooMuch = await api('POST', `/api/admin/users/${budi.id}/coins`, { token: admin.token, body: { amount: -999999 } });
  assert.equal(tooMuch.status, 402);
  assert.equal((await api('POST', `/api/admin/users/${budi.id}/coins`, { token: admin.token, body: { amount: 0 } })).status, 400);

  const log = await api('GET', '/api/admin/coin-log', { token: admin.token });
  assert.equal(log.status, 200);
  assert.equal(log.body.length, 2);
  assert.deepEqual(log.body.map((r) => r.amount), [-1200, 5000], 'terbaru dulu');
  assert.equal(log.body[0].balanceAfter, 3800);
  assert.equal(log.body[1].note, 'Top up uji');
  assert.equal(log.body[1].admin, 'admin');
  assert.equal(log.body[1].username, 'budi');

  const other = await api('GET', `/api/admin/coin-log?userId=${sari.id}`, { token: admin.token });
  assert.equal(other.body.length, 0);
  assert.equal((await api('GET', '/api/admin/coin-log', { token: budi.token })).status, 403);
});

test('video efek gift: hanya MP4 asli, admin saja, ikut terkirim di pesan gift', async () => {
  // MP4 minimal: kotak ftyp valid
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
  const up = async (token, buf, type) => {
    const f = new FormData();
    f.append('file', new Blob([buf], { type }), 'efek.mp4');
    return api('POST', '/api/admin/upload-video', { token, form: f });
  };
  const ok = await up(admin.token, mp4, 'video/mp4');
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.match(ok.body.url, /\/uploads\/.+\.mp4$/);
  const served = await fetch(ok.body.url.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(served.status, 200);

  // tipe benar tapi isi bukan MP4, tipe salah, dan bukan admin
  assert.equal((await up(admin.token, Buffer.from('ini bukan video sama sekali'), 'video/mp4')).status, 400);
  assert.equal((await up(admin.token, mp4, 'video/webm')).status, 400);
  assert.equal((await up(budi.token, mp4, 'video/mp4')).status, 403);

  // gift dengan efek video & mode transparan, lalu dikirim: pesan membawa datanya
  const g = await api('POST', '/api/admin/gifts', { token: admin.token, body: { name: 'Naga', price: 100, icon: '🐉', category: 'luxury', animationUrl: ok.body.url, animationBlend: true } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.equal(g.body.animationUrl, ok.body.url);
  assert.equal(g.body.animationBlend, true);
  await api('PATCH', `/api/admin/users/${budi.id}/status`, { token: admin.token, body: { status: 'active' } });
  const list = await api('GET', '/api/gifts', { token: budi.token });
  const naga = list.body.find((x) => x.name === 'Naga');
  assert.equal(naga.animationBlend, true);

  await db.query(`UPDATE users SET gender = 'male', profile_completed = true, coins = 5000 WHERE id = $1`, [budi.id]);
  await db.query(`UPDATE users SET gender = 'female', profile_completed = true WHERE id = $1`, [sari.id]);
  await db.query(`INSERT INTO host_profiles (user_id, chat_price) VALUES ($1, 10) ON CONFLICT DO NOTHING`, [sari.id]);
  const conv = await api('POST', '/api/conversations', { token: budi.token, body: { hostId: sari.id } });
  assert.equal(conv.status, 200, JSON.stringify(conv.body));
  const sent = await api('POST', `/api/conversations/${conv.body.id}/gifts`, { token: budi.token, body: { giftId: naga.id, count: 1 } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.message.gift.animationUrl, ok.body.url);
  assert.equal(sent.body.message.gift.animationBlend, true);

  // hapus efek video: string kosong mengosongkan kolom
  const cleared = await api('PATCH', `/api/admin/gifts/${naga.id}`, { token: admin.token, body: { animationUrl: '', animationBlend: false } });
  assert.equal(cleared.body.animationUrl, null);
  assert.equal(cleared.body.animationBlend, false);
});

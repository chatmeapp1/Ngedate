/**
 * Foto/video privat dari host: kirim, batas 5 menit, buka dengan koin, akses file terproteksi.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
// Folder privat khusus tes (jangan menyentuh folder privat asli)
process.env.PRIVATE_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'amora-private-'));
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');
const storage = require('../src/lib/storage');

let server;
let base;
let admin;
let host;
let user;
let other;
let conv;

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
const coins = async (id) => Number((await db.query(`SELECT coins FROM users WHERE id = $1`, [id])).rows[0].coins);
const diamonds = async (id) => Number((await db.query(`SELECT diamonds FROM users WHERE id = $1`, [id])).rows[0].diamonds);

// MP4 minimal dengan durasi tertentu (kotak ftyp + moov/mvhd)
function mp4(seconds) {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(12)]);
  const mvhd = Buffer.alloc(28);
  mvhd.writeUInt32BE(28, 0);
  mvhd.write('mvhd', 4, 'latin1');
  mvhd.writeUInt32BE(1000, 20); // timescale
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 24); // durasi
  const moov = Buffer.concat([Buffer.from([0, 0, 0, 36]), Buffer.from('moov'), mvhd]);
  return Buffer.concat([ftyp, moov, Buffer.alloc(300, 7)]);
}
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 9)]);

async function sendPrivate(token, convId, bytes, type, name, price) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  if (price !== undefined) form.append('price', String(price));
  const res = await fetch(`${base}/api/conversations/${convId}/private-media`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const getMedia = (token, id, headers = {}) => fetch(`${base}/api/media/${id}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
const privateFiles = () => fs.readdirSync(storage.PRIVATE_DIR);

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

  host = await register('hostprivat');
  await A('PATCH', `/api/admin/users/${host.id}/role`, { role: 'host' });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [host.id]);
  await api('PATCH', '/api/host/settings', { token: host.token, body: { chatPrice: 100 } });
  user = await register('penonton');
  other = await register('orangluar');
  await A('POST', `/api/admin/users/${user.id}/coins`, { amount: 2000 });
  conv = (await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } })).body;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('host mengirim foto privat berharga; hanya host yang boleh; harga dibatasi', async () => {
  const bad = await sendPrivate(user.token, conv.id, jpg, 'image/jpeg', 'a.jpg', 100);
  assert.equal(bad.status, 403, 'pengguna tidak bisa mengirim media privat');

  const tooHigh = await sendPrivate(host.token, conv.id, jpg, 'image/jpeg', 'a.jpg', 999999999);
  assert.equal(tooHigh.status, 400);
  const fake = await sendPrivate(host.token, conv.id, Buffer.from('bukan gambar'), 'image/jpeg', 'x.jpg', 100);
  assert.equal(fake.body.error.code, 'INVALID_FILE');

  const before = privateFiles().length;
  const ok = await sendPrivate(host.token, conv.id, jpg, 'image/jpeg', 'a.jpg', 500);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const m = ok.body.message;
  assert.equal(m.type, 'image');
  assert.equal(m.mediaPrivate, true);
  assert.equal(m.mediaPrice, 500);
  assert.equal(m.mediaUnlocked, false);
  assert.equal(m.mediaUrl, `/api/media/${m.id}`, 'URL lewat API terproteksi, bukan /uploads');
  assert.equal(privateFiles().length, before + 1);
  assert.ok(!fs.readdirSync(storage.UPLOAD_DIR).some((f) => f.endsWith('.jpg') && fs.readFileSync(path.join(storage.UPLOAD_DIR, f)).equals(jpg) && f.includes('private')), 'tidak di folder publik');
  global.photoId = m.id;
});

test('video maksimal 5 menit (durasi dibaca dari file); terlalu panjang ditolak dan file dihapus', async () => {
  const before = privateFiles().length;
  const long = await sendPrivate(host.token, conv.id, mp4(6 * 60), 'video/mp4', 'v.mp4', 300);
  assert.equal(long.status, 400);
  assert.equal(long.body.error.code, 'VIDEO_TOO_LONG');
  assert.equal(privateFiles().length, before, 'file video yang ditolak tidak tersisa');

  const noDur = await sendPrivate(host.token, conv.id, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(100)]), 'video/mp4', 'v.mp4', 300);
  assert.equal(noDur.status, 400, 'durasi tidak terbaca ditolak');

  const ok = await sendPrivate(host.token, conv.id, mp4(4 * 60), 'video/mp4', 'v.mp4', 300);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.message.type, 'video');
  const five = await sendPrivate(host.token, conv.id, mp4(300), 'video/mp4', 'v5.mp4', 0);
  assert.equal(five.status, 201, 'tepat 5 menit masih boleh');
  global.videoId = ok.body.message.id;
  global.freeId = five.body.message.id;
});

const listFor = async (token) => {
  const r = (await api('GET', `/api/conversations/${conv.id}/messages?limit=100`, { token })).body;
  return Array.isArray(r) ? r : r.messages;
};

test('review admin: media baru menunggu; pengguna belum melihat, belum bisa membuka; host melihat statusnya', async () => {
  // semua media yang dikirim sampai sini masih menunggu persetujuan
  const hostList = await listFor(host.token);
  const mine = hostList.filter((m) => m.mediaPrivate);
  assert.ok(mine.length >= 3 && mine.every((m) => m.mediaReview === 'pending'), 'host melihat semuanya berstatus pending');
  assert.equal((await listFor(user.token)).some((m) => m.mediaPrivate), false, 'pengguna tidak melihat yang belum disetujui');
  assert.equal((await getMedia(user.token, global.freeId)).status, 404, 'file belum disetujui tidak bisa dibuka pengguna');
  assert.equal((await getMedia(host.token, global.freeId)).status, 200, 'host tetap bisa melihat kirimannya');
  assert.equal((await api('POST', `/api/conversations/${conv.id}/media/${global.photoId}/unlock`, { token: user.token })).status, 404, 'tidak bisa dibuka sebelum disetujui');
  const unread0 = (await db.query(`SELECT user_unread FROM conversations WHERE id = $1`, [conv.id])).rows[0].user_unread;
  assert.equal(unread0, 0, 'pengguna belum diberi tahu');

  // admin: antrean, hanya admin, lihat file
  const q = (await A('GET', '/api/admin/private-media?status=pending')).body;
  assert.ok(q.length >= 3 && q.every((m) => m.status === 'pending' && m.host.id === host.id));
  assert.equal((await api('GET', '/api/admin/private-media', { token: host.token })).status, 403);
  const file = await fetch(`${base}/api/admin/private-media/${global.photoId}/file`, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(file.status, 200);
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(jpg), 'admin melihat file aslinya');
  assert.equal((await A('GET', '/api/admin/stats')).body.pending.privateMedia >= 3, true);

  // setujui semuanya: pengguna menerima pesan + belum dibaca, host diberi notifikasi
  for (const id of [global.photoId, global.videoId, global.freeId]) assert.equal((await A('POST', `/api/admin/private-media/${id}/approve`)).status, 200);
  assert.equal((await A('POST', `/api/admin/private-media/${global.photoId}/approve`)).status, 404, 'tidak bisa diproses dua kali');
  const row = (await db.query(`SELECT user_unread, last_message_preview FROM conversations WHERE id = $1`, [conv.id])).rows[0];
  assert.equal(row.user_unread >= 3, true);
  assert.match(row.last_message_preview, /privat/i);
  const userList = await listFor(user.token);
  assert.ok(userList.some((m) => m.id === global.photoId && m.mediaReview === 'approved'));
  const notes = (await api('GET', '/api/notifications', { token: host.token })).body;
  assert.ok(notes.some((n) => n.type === 'media' && /disetujui/.test(n.title)));
});

test('review admin: ditolak = file dihapus, pengguna tidak pernah melihat; hapus media yang sudah disetujui', async () => {
  const before = privateFiles().length;
  const bad = await sendPrivate(host.token, conv.id, jpg, 'image/jpeg', 'bad.jpg', 100);
  const badId = bad.body.message.id;
  assert.equal(bad.body.message.mediaReview, 'pending');
  assert.equal(privateFiles().length, before + 1);

  assert.equal((await A('POST', `/api/admin/private-media/${badId}/reject`, { reason: 'konten tidak pantas' })).status, 200);
  assert.equal(privateFiles().length, before, 'file dihapus dari server');
  const hostSees = (await listFor(host.token)).find((m) => m.id === badId);
  assert.deepEqual([hostSees.mediaReview, hostSees.mediaReviewReason, hostSees.mediaUrl], ['rejected', 'konten tidak pantas', null]);
  assert.equal((await listFor(user.token)).some((m) => m.id === badId), false, 'pengguna tidak pernah melihatnya');
  assert.equal((await getMedia(host.token, badId)).status, 404);
  assert.equal((await fetch(`${base}/api/admin/private-media/${badId}/file`, { headers: { authorization: `Bearer ${admin}` } })).status, 404, 'file sudah tidak ada');
  const rej = (await A('GET', '/api/admin/private-media?status=rejected')).body;
  assert.ok(rej.some((m) => m.id === badId && m.reason === 'konten tidak pantas' && !m.hasFile));
  const notes = (await api('GET', '/api/notifications', { token: host.token })).body;
  assert.ok(notes.some((n) => n.type === 'media' && /ditolak/.test(n.title) && /tidak pantas/.test(n.body)));

  // hapus media yang sudah disetujui (belum dibuka siapa pun)
  const ok = await sendPrivate(host.token, conv.id, jpg, 'image/jpeg', 'ok.jpg', 100);
  await A('POST', `/api/admin/private-media/${ok.body.message.id}/approve`);
  assert.ok((await listFor(user.token)).some((m) => m.id === ok.body.message.id));
  assert.equal((await A('POST', `/api/admin/private-media/${ok.body.message.id}/reject`, {})).status, 200);
  assert.equal((await listFor(user.token)).some((m) => m.id === ok.body.message.id), false, 'setelah dihapus admin, hilang dari pengguna');
  assert.equal((await getMedia(user.token, ok.body.message.id)).status, 404);
  assert.equal((await api('POST', `/api/conversations/${conv.id}/media/${ok.body.message.id}/unlock`, { token: user.token })).status, 404);
});

test('akses file terproteksi: host & pengguna yang sudah membuka saja; Range didukung', async () => {
  assert.equal((await getMedia(null, global.photoId)).status, 401);
  const hostView = await getMedia(host.token, global.photoId);
  assert.equal(hostView.status, 200);
  assert.ok(Buffer.from(await hostView.arrayBuffer()).equals(jpg), 'host melihat file aslinya');
  assert.equal((await getMedia(other.token, global.photoId)).status, 404, 'orang luar tidak bisa');
  const locked = await getMedia(user.token, global.photoId);
  assert.equal(locked.status, 402, 'pengguna belum membuka: terkunci');
  assert.equal((await locked.json()).error.code, 'MEDIA_LOCKED');

  // media gratis (harga 0) langsung bisa dilihat pengguna, dan Range menghasilkan 206
  const free = await getMedia(user.token, global.freeId, { range: 'bytes=0-3' });
  assert.equal(free.status, 206);
  assert.equal((await free.arrayBuffer()).byteLength, 4);
});

test('pengguna membuka foto: koin dipotong, host dapat bagian gift (10%), tercatat, tidak dobel', async () => {
  const c0 = await coins(user.id);
  const d0 = await diamonds(host.id);
  const u = await api('POST', `/api/conversations/${conv.id}/media/${global.photoId}/unlock`, { token: user.token });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.paid, 500);
  assert.equal(u.body.message.mediaUnlocked, true);
  assert.equal(await coins(user.id), c0 - 500);
  assert.equal(await diamonds(host.id), d0 + 50, '10% dari 500 koin');
  const led = await db.query(`SELECT amount FROM ledger WHERE user_id = $1 AND reason = 'media_income'`, [host.id]);
  assert.equal(led.rows.length, 1);
  assert.equal((await db.query(`SELECT gift_total FROM conversations WHERE id = $1`, [conv.id])).rows[0].gift_total, '500', 'ikut total belanja untuk buka WhatsApp');

  const view = await getMedia(user.token, global.photoId);
  assert.equal(view.status, 200);
  assert.ok(Buffer.from(await view.arrayBuffer()).equals(jpg));

  const again = await api('POST', `/api/conversations/${conv.id}/media/${global.photoId}/unlock`, { token: user.token });
  assert.equal(again.status, 200);
  assert.equal(again.body.paid, 0, 'sudah dibuka: tidak dipotong lagi');
  assert.equal(await coins(user.id), c0 - 500);

  // host: penghasilan hari ini ikut menghitung buka media
  const me = (await api('GET', '/api/me', { token: host.token })).body.membership;
  assert.ok(me.earnedToday >= 50);

  // daftar pesan: pengguna melihat status terbuka
  const msgs = (await api('GET', `/api/conversations/${conv.id}/messages`, { token: user.token })).body;
  const list = Array.isArray(msgs) ? msgs : msgs.messages;
  const photo = list.find((x) => x.id === global.photoId);
  assert.equal(photo.mediaUnlocked, true);
});

test('koin tidak cukup tidak membuka; hanya pengguna percakapan itu; batas kirim per hari', async () => {
  await db.query(`UPDATE users SET coins = 10 WHERE id = $1`, [user.id]);
  const poor = await api('POST', `/api/conversations/${conv.id}/media/${global.videoId}/unlock`, { token: user.token });
  assert.equal(poor.status, 402);
  assert.equal((await getMedia(user.token, global.videoId)).status, 402, 'tetap terkunci');
  assert.equal((await api('POST', `/api/conversations/${conv.id}/media/${global.videoId}/unlock`, { token: other.token })).status, 404);
  assert.equal((await api('POST', `/api/conversations/${conv.id}/media/${global.videoId}/unlock`, { token: host.token })).status, 403);

  await A('PATCH', '/api/admin/settings', { host_media_per_day: 3 });
  const lim = await sendPrivate(host.token, conv.id, jpg, 'image/jpeg', 'z.jpg', 100);
  assert.equal(lim.status, 429);
  assert.equal(lim.body.error.code, 'MEDIA_LIMIT');
  await A('PATCH', '/api/admin/settings', { host_media_per_day: 30 });
});

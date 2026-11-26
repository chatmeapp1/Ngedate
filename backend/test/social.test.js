/**
 * Job 2: negara, pencarian host, profil lengkap, ikuti/suka, album foto, dinding hadiah.
 * Database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amora-upload-'));
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');

let server;
let base;

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

async function register(username, countryCode) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username, countryCode } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.user.id, token: r.body.accessToken };
}

// (tes pemisahan gender ada di akhir file)
async function makeHost(username, country) {
  const h = await register(username, country);
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved', profile_completed = true WHERE id = $1`, [h.id]);
  await db.query(`INSERT INTO host_profiles (user_id, chat_price) VALUES ($1, 100)`, [h.id]);
  return h;
}

// PNG 1x1 piksel
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
function imageForm(type = 'image/png', data = PNG) {
  const f = new FormData();
  f.append('file', new Blob([data], { type }), 'foto.png');
  return f;
}

let user, idHost, idHost2, phHost;

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  server = http.createServer(createApp());
  realtime.attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  user = await register('pembeli', 'ID');
  idHost = await makeHost('sari', 'ID');
  idHost2 = await makeHost('dewi', 'id');
  phHost = await makeHost('maria', 'PH');
  await db.query(`UPDATE users SET display_name = 'Maria Cantik' WHERE id = $1`, [phHost.id]);
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('jumlah host per negara', async () => {
  const r = await api('GET', '/api/hosts/countries', { token: user.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, [{ code: 'ID', count: 2 }, { code: 'PH', count: 1 }]);
});

test('filter negara, cari nama/ID, dan tab', async () => {
  const id = await api('GET', '/api/hosts?country=id', { token: user.token });
  assert.deepEqual(id.body.map((h) => h.username).sort(), ['dewi', 'sari']);
  assert.equal(id.body[0].countryCode, 'ID');

  const byName = await api('GET', '/api/hosts?q=cantik', { token: user.token });
  assert.deepEqual(byName.body.map((h) => h.id), [phHost.id]);

  const byId = await api('GET', `/api/hosts?q=${idHost.id}`, { token: user.token });
  assert.ok(byId.body.some((h) => h.id === idHost.id));

  const online = await api('GET', '/api/hosts?tab=online', { token: user.token });
  assert.equal(online.body.length, 0, 'tidak ada yang tersambung socket');

  const bad = await api('GET', '/api/hosts?tab=apa', { token: user.token });
  assert.equal(bad.status, 400);

  // Pencarian tidak boleh bisa disusupi SQL
  const inj = await api('GET', `/api/hosts?q=${encodeURIComponent("' OR 1=1 --")}`, { token: user.token });
  assert.equal(inj.status, 200);
  assert.equal(inj.body.length, 0);
});

test('tab populer: host dengan gift terbanyak di atas', async () => {
  const { rows } = await db.query(`INSERT INTO gifts (name, price) VALUES ('Mawar', 10) RETURNING id`);
  const conv = await db.query(`INSERT INTO conversations (user_id, host_id) VALUES ($1, $2) RETURNING id`, [user.id, phHost.id]);
  await db.query(
    `INSERT INTO messages (conversation_id, sender_id, type, gift_id, gift_count, price, payment_status)
     VALUES ($1, $2, 'gift', $3, 5, 50, 'paid')`,
    [conv.rows[0].id, user.id, rows[0].id]
  );
  const r = await api('GET', '/api/hosts?tab=popular', { token: user.token });
  assert.equal(r.body[0].id, phHost.id);
});

test('ikuti & suka: idempoten dan terhitung di profil', async () => {
  for (let i = 0; i < 2; i++) {
    const f = await api('POST', `/api/users/${idHost.id}/follow`, { token: user.token });
    assert.deepEqual(f.body, { isFollowing: true, followers: 1, likes: 0 });
  }
  const l = await api('POST', `/api/users/${idHost.id}/like`, { token: user.token });
  assert.equal(l.body.likes, 1);
  const self = await api('POST', `/api/users/${user.id}/follow`, { token: user.token });
  assert.equal(self.status, 400);
  const likeUser = await api('POST', `/api/users/${user.id}/like`, { token: idHost.token });
  assert.equal(likeUser.status, 400, 'hanya host yang bisa disukai');

  const p = await api('GET', `/api/hosts/${idHost.id}`, { token: user.token });
  assert.equal(p.status, 200);
  assert.equal(p.body.followers, 1);
  assert.equal(p.body.likes, 1);
  assert.equal(p.body.isFollowing, true);
  assert.equal(p.body.isLiked, true);
  assert.equal(p.body.avgReplyMinutes, null, 'belum cukup data balasan');
  assert.equal(p.body.conversation, null);

  const un = await api('DELETE', `/api/users/${idHost.id}/follow`, { token: user.token });
  assert.equal(un.body.followers, 0);
});

test('negara & umur di profil sendiri', async () => {
  const r = await api('PATCH', '/api/me', { token: user.token, body: { countryCode: 'vn', birthDate: '1995-05-01' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.countryCode, 'VN');
  assert.ok(r.body.age >= 30);
  const minor = await api('PATCH', '/api/me', { token: user.token, body: { birthDate: '2015-01-01' } });
  assert.equal(minor.body.error.code, 'UNDERAGE');
});

test('foto host masuk antrean cek admin, tampil setelah disetujui', async () => {
  const bcrypt = require('bcryptjs');
  await db.query(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]
  );
  const admin = (await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } })).body.accessToken;

  // Foto profil host: menunggu, foto lama (kosong) tetap dipakai
  const a = await api('POST', '/api/me/avatar', { token: idHost.token, form: imageForm() });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.avatarUrl, null);
  assert.match(a.body.pendingAvatarUrl, /\/uploads\/.+\.png$/);
  assert.equal((await fetch(a.body.pendingAvatarUrl)).status, 200);

  const p1 = await api('POST', '/api/me/photos', { token: idHost.token, form: imageForm() });
  const p2 = await api('POST', '/api/me/photos', { token: idHost.token, form: imageForm() });
  assert.equal(p1.status, 201);
  assert.equal(p1.body.status, 'pending');

  const bad = await api('POST', '/api/me/photos', { token: idHost.token, form: imageForm('text/plain', Buffer.from('halo')) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_FILE');

  // Belum disetujui: publik tidak melihat apa-apa
  let profile = await api('GET', `/api/hosts/${idHost.id}`, { token: user.token });
  assert.equal(profile.body.photos.length, 0);
  assert.equal(profile.body.avatarUrl, null);

  // Admin menyetujui foto profil & satu foto album, menolak yang lain
  const pending = await api('GET', '/api/admin/photos/pending', { token: admin });
  assert.equal(pending.body.album.length, 2);
  assert.equal(pending.body.avatars[0].userId, idHost.id);
  assert.equal((await api('POST', `/api/admin/users/${idHost.id}/avatar/approve`, { token: admin })).status, 200);
  assert.equal((await api('POST', `/api/admin/photos/${p1.body.id}/approve`, { token: admin })).status, 200);
  const rej = await api('POST', `/api/admin/photos/${p2.body.id}/reject`, { token: admin, body: { reason: 'Foto buram' } });
  assert.equal(rej.status, 200);

  profile = await api('GET', `/api/hosts/${idHost.id}`, { token: user.token });
  assert.deepEqual(profile.body.photos.map((x) => x.id), [p1.body.id]);
  assert.match(profile.body.avatarUrl, /\/uploads\//);

  // Pemilik melihat status & alasan penolakan
  const mine = await api('GET', '/api/me/photos', { token: idHost.token });
  assert.deepEqual(mine.body.map((x) => [x.status, x.rejectReason]), [['approved', null], ['rejected', 'Foto buram']]);

  // Foto user biasa langsung tampil
  const up = await api('POST', '/api/me/photos', { token: user.token, form: imageForm() });
  assert.equal(up.body.status, 'approved');

  // Orang lain tidak bisa menghapus foto host
  await api('DELETE', `/api/me/photos/${p1.body.id}`, { token: user.token });
  assert.equal((await api('GET', `/api/hosts/${idHost.id}`, { token: user.token })).body.photos.length, 1);
});

test('dinding hadiah & percakapan user di profil host', async () => {
  const r = await api('GET', `/api/hosts/${phHost.id}/gifts`, { token: user.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.gifts.map((g) => [g.name, g.count]), [['Mawar', 5]]);
  assert.equal(r.body.topSenders[0].user.id, user.id);
  assert.equal(r.body.topSenders[0].total, 50);

  const p = await api('GET', `/api/hosts/${phHost.id}`, { token: user.token });
  assert.ok(p.body.conversation);
  assert.equal(p.body.conversation.waUnlocked, false);
});

test('wilayah: selalu 6 kartu, jumlah host & filter wilayah', async () => {
  const r = await api('GET', '/api/hosts/regions', { token: user.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((x) => x.key), ['asia', 'arab', 'india', 'latino', 'afrika', 'barat']);
  const asia = r.body.find((x) => x.key === 'asia');
  assert.equal(asia.count, 3, 'ID + ID + PH');
  assert.ok(asia.coverUrl, 'foto host teratas');
  assert.equal(r.body.find((x) => x.key === 'barat').count, 0);
  assert.equal(r.body.find((x) => x.key === 'barat').coverUrl, null);

  const list = await api('GET', '/api/hosts?region=asia', { token: user.token });
  assert.equal(list.body.length, 3);
  const none = await api('GET', '/api/hosts?region=latino', { token: user.token });
  assert.equal(none.body.length, 0);
  const bad = await api('GET', '/api/hosts?region=mars', { token: user.token });
  assert.equal(bad.status, 400);
});

test('beranda dipisah gender: host melihat pria, user tidak melihat host pria', async () => {
  const male = await register('cowok1', 'ID');
  await db.query(`UPDATE users SET gender = 'male', profile_completed = true WHERE id = $1`, [male.id]);
  const female = await register('cewek1', 'ID');
  await db.query(`UPDATE users SET gender = 'female', profile_completed = true WHERE id = $1`, [female.id]);
  const hostF = await makeHost('hostcewek', 'ID');
  await db.query(`UPDATE users SET gender = 'female' WHERE id = $1`, [hostF.id]);
  const hostM = await makeHost('hostcowok', 'ID');
  await db.query(`UPDATE users SET gender = 'male' WHERE id = $1`, [hostM.id]);

  // Pria melihat host wanita saja
  const hosts = await api('GET', '/api/hosts', { token: male.token });
  assert.equal(hosts.status, 200);
  const names = hosts.body.map((h) => h.username);
  assert.ok(names.includes('hostcewek'));
  assert.ok(!names.includes('hostcowok'), 'host pria tidak tampil');

  // Host melihat pengguna pria saja
  const members = await api('GET', '/api/members', { token: hostF.token });
  assert.equal(members.status, 200);
  const mn = members.body.map((m) => m.username);
  assert.ok(mn.includes('cowok1'));
  assert.ok(!mn.includes('cewek1'), 'wanita tidak tampil');
  assert.ok(!mn.includes('hostcowok'), 'host tidak tampil sebagai member');

  const one = await api('GET', `/api/members/${male.id}`, { token: hostF.token });
  assert.equal(one.status, 200);
  assert.equal(one.body.username, 'cowok1');
  assert.equal((await api('GET', `/api/members/${female.id}`, { token: hostF.token })).status, 404);

  // User biasa tidak boleh memakai endpoint member
  assert.equal((await api('GET', '/api/members', { token: male.token })).status, 403);
});

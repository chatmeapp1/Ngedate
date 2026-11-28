/**
 * Filter kontak: nomor ditulis dengan kata/emoji/angka lebar, dan nomor yang dipecah ke banyak pesan.
 * PERINGATAN: bagian API memakai database test dan MENGOSONGKANNYA.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const { containsContact, splitNumberLeak } = require('../src/lib/contactFilter');
const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');

test('nomor yang ditulis dengan kata (Indonesia dan Inggris) diblokir', () => {
  for (const t of [
    'Satu dua tiga empat lima enam tujuh delapan sembilan kosong',
    'nol delapan satu dua tiga empat lima enam tujuh delapan',
    'zero eight one two three four five six seven eight',
    'kosong-delapan-satu-dua-tiga-empat-lima-enam-tujuh',
    'NOL DELAPAN LIMA SATU TIGA EMPAT LIMA ENAM TUJUH',
  ]) assert.equal(containsContact(t), true, t);
});

test('nomor dengan angka lebar, Arab, emoji, spasi, dan huruf o/l di antara angka diblokir', () => {
  for (const t of [
    '０８１２３４５６７８９０',
    '٠٨١٢٣٤٥٦٧٨٩٠',
    '0️⃣8️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣',
    '0 8 1 2 3 4 5 6 7 8 9',
    '08l2 3456 7890',
    '+62 812-3456-7890',
  ]) assert.equal(containsContact(t), true, t);
});

test('obrolan biasa dengan angka tetap boleh', () => {
  for (const t of [
    'umur aku 25 tahun',
    'jam 8 malam ya',
    'Rp 100.000 saja',
    'ID saya 100002',
    'aku punya dua kucing dan tiga ikan',
    'satu dua tiga ayo mulai',
    'tinggi 165 berat 50',
    'hari ini tanggal 28',
  ]) assert.equal(containsContact(t), false, t);
});

test('nomor dipecah ke banyak pesan: dijumlahkan dari pesan bernuansa angka', () => {
  // yang dikirim pengguna di screenshot: 08, 54, 081, 3110, 731314
  assert.equal(splitNumberLeak([], '08'), false);
  assert.equal(splitNumberLeak(['08'], '54'), false);
  assert.equal(splitNumberLeak(['54', '08'], '081'), false, '7 digit belum cukup');
  assert.equal(splitNumberLeak(['081', '54', '08'], '3110'), true, 'sampai 11 digit: diblokir');
  // dipecah dengan kata angka
  assert.equal(splitNumberLeak(['nol delapan satu'], 'dua tiga empat lima enam'), true);
  // pesan biasa yang memuat angka tidak dihitung
  assert.equal(splitNumberLeak(['umur 25', 'jam 8 malam', 'tinggi 165'], 'aku 50 kilo'), false);
  assert.equal(splitNumberLeak(['08', '54'], 'halo apa kabar'), false, 'pesan non-angka tidak diblokir');
});

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

test('di chat: pesan nomor pecahan diblokir untuk pengguna dan host', async () => {
  const host = await register('hostfilter');
  await api('PATCH', `/api/admin/users/${host.id}/role`, { token: admin, body: { role: 'host' } });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [host.id]);
  const user = await register('userfilter');
  await db.query(`UPDATE users SET gender = 'male', profile_completed = true WHERE id = $1`, [user.id]);
  await api('POST', `/api/admin/users/${user.id}/coins`, { token: admin, body: { amount: 100000 } });
  const conv = (await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } })).body;
  const send = (token, text) => api('POST', `/api/conversations/${conv.id}/messages`, { token, body: { body: text } });

  // pengguna: 08, 54, 081 lolos (7 digit), 3110 diblokir; pesan biasa tetap boleh
  assert.equal((await send(user.token, '08')).status, 201);
  assert.equal((await send(user.token, '54')).status, 201);
  assert.equal((await send(user.token, '081')).status, 201);
  const blocked = await send(user.token, '3110');
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error.code, 'CONTACT_BLOCKED');
  assert.equal((await send(user.token, 'oke halo, apa kabar?')).status, 201);
  assert.equal((await send(user.token, 'kosong delapan satu dua tiga empat lima enam tujuh delapan')).status, 422);

  // host: pecahan yang sama juga diblokir
  assert.equal((await send(host.token, 'tujuh delapan sembilan')).status, 201);
  assert.equal((await send(host.token, 'nol satu dua tiga empat')).status, 422);
  // angka biasa tidak mengganggu
  assert.equal((await send(host.token, 'umur aku 24 tahun')).status, 201);
});

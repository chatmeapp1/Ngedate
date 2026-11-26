/**
 * Paket koin untuk layar Top up.
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
let admin, indo, asing, tanpaNegara;

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(username, country) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username, countryCode: country } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: Number(r.body.user.id), token: r.body.accessToken };
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
  admin = { token: login.body.accessToken };
  indo = await register('budi', 'ID');
  asing = await register('john', 'US');
  tanpaNegara = await register('anon');
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('8 paket awal: harga tepat Rp 2,55 dan US$ 0,00015 per koin, urut naik', async () => {
  const r = await api('GET', '/api/admin/packages', { token: admin.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((p) => p.coins), [18000, 36000, 54000, 90000, 180000, 450000, 900000, 1800000]);
  for (const p of r.body) {
    assert.equal(p.priceIdr, Math.round(p.coins * 2.55), `Rupiah ${p.coins}`);
    assert.equal(p.priceUsdCents, Math.round(p.coins * 0.015), `USD ${p.coins}`);
    assert.equal(p.active, true);
  }
  assert.equal(r.body[0].priceIdr, 45900);
  assert.equal(r.body[7].priceIdr, 4590000);
  assert.equal(r.body[0].priceUsdCents, 270);
  assert.equal(r.body[7].priceUsdCents, 27000);
});

test('pengguna melihat paket aktif; mata uang mengikuti negara', async () => {
  assert.equal((await api('GET', '/api/packages')).status, 401);
  const id = await api('GET', '/api/packages', { token: indo.token });
  assert.equal(id.status, 200);
  assert.equal(id.body.currency, 'IDR');
  assert.equal(id.body.packages.length, 8);
  assert.equal(id.body.packages[0].coins, 18000);
  assert.equal(id.body.contact, null, 'kontak belum diatur');
  assert.ok(id.body.note.length > 0, 'ada catatan bawaan');
  assert.equal((await api('GET', '/api/packages', { token: asing.token })).body.currency, 'USD');
  assert.equal((await api('GET', '/api/packages', { token: tanpaNegara.token })).body.currency, 'USD');
});

test('admin mengelola paket: validasi, duplikat, label, nonaktif, hapus; bukan admin ditolak', async () => {
  assert.equal((await api('GET', '/api/admin/packages', { token: indo.token })).status, 403);
  const post = (b) => api('POST', '/api/admin/packages', { token: admin.token, body: b });
  const full = { coins: 9000, priceIdr: 22950, priceUsdCents: 135 };
  assert.equal((await post({ ...full, coins: 50 })).status, 400, 'terlalu sedikit');
  assert.equal((await post({ ...full, priceIdr: 0 })).status, 400);
  assert.equal((await post({ ...full, priceUsdCents: 0 })).status, 400);
  assert.equal((await post({ ...full, badge: 'x'.repeat(30) })).status, 400);
  const dup = await post({ ...full, coins: 18000 });
  assert.equal(dup.status, 400);
  assert.equal(dup.body.error.code, 'DUPLICATE_PACKAGE');

  const ok = await post({ ...full, badge: 'Baru', sortOrder: 0 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.badge, 'Baru');
  let list = (await api('GET', '/api/packages', { token: indo.token })).body.packages;
  assert.equal(list[0].coins, 9000, 'urutan 0 tampil paling atas');
  assert.equal(list[0].badge, 'Baru');

  const upd = await api('PATCH', `/api/admin/packages/${ok.body.id}`, { token: admin.token, body: { badge: '', priceIdr: 23000 } });
  assert.equal(upd.body.badge, null, 'label kosong menghapus');
  assert.equal(upd.body.priceIdr, 23000);
  assert.equal((await api('PATCH', `/api/admin/packages/${ok.body.id}`, { token: admin.token, body: {} })).status, 400);
  assert.equal((await api('PATCH', '/api/admin/packages/999999', { token: admin.token, body: { active: false } })).status, 404);

  // nonaktif: hilang dari layar pengguna tapi tetap ada di admin
  await api('PATCH', `/api/admin/packages/${ok.body.id}`, { token: admin.token, body: { active: false } });
  list = (await api('GET', '/api/packages', { token: indo.token })).body.packages;
  assert.ok(!list.some((p) => p.coins === 9000));
  assert.ok((await api('GET', '/api/admin/packages', { token: admin.token })).body.some((p) => p.coins === 9000 && p.active === false));

  assert.equal((await api('DELETE', `/api/admin/packages/${ok.body.id}`, { token: admin.token })).status, 200);
  assert.equal((await api('DELETE', `/api/admin/packages/${ok.body.id}`, { token: admin.token })).status, 404);
});

test('kontak WhatsApp top up dinormalkan; catatan pembayaran dibatasi', async () => {
  const set = (b) => api('PATCH', '/api/admin/settings', { token: admin.token, body: b });
  const contact = async () => (await api('GET', '/api/packages', { token: indo.token })).body.contact;

  assert.equal((await set({ topup_contact: '123' })).status, 400, 'terlalu pendek');
  assert.equal((await set({ topup_contact: '0812-3456-7890' })).status, 200);
  assert.equal(await contact(), '6281234567890', '08xx menjadi 628xx');
  assert.equal((await set({ topup_contact: '+1 (415) 555-0100' })).status, 200);
  assert.equal(await contact(), '14155550100');
  assert.equal((await set({ topup_contact: '' })).status, 200);
  assert.equal(await contact(), null, 'kosong = tidak diatur');

  assert.equal((await set({ topup_note: 'x'.repeat(501) })).status, 400);
  assert.equal((await set({ topup_note: '  Transfer ke BCA 123, lalu kirim bukti.  ' })).status, 200);
  assert.equal((await api('GET', '/api/packages', { token: indo.token })).body.note, 'Transfer ke BCA 123, lalu kirim bukti.');
});

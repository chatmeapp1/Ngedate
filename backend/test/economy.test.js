/**
 * Pengaman anti-rugi: margin per koin dan penolakan pengaturan yang membuat app rugi.
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

const A = (method, p, body) => api(method, p, { token: admin.token, body });
const setting = async (key) => (await A('GET', '/api/admin/settings')).body[key];

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
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('nilai awal: 1 diamond = Rp 2,55, harga jual Rp 2 per koin, untung positif bahkan potongan Play 30%', async () => {
  assert.equal(await setting('withdraw_diamonds_per_usd'), 6667);
  assert.equal(await setting('withdraw_usd_idr'), 17000);
  assert.equal(await setting('host_share'), 0.3);

  const m = (await A('GET', '/api/admin/margin')).body;
  assert.ok(Math.abs(m.pricePerCoin - 2) < 0.001, 'harga jual terendah ~ Rp 2');
  assert.ok(Math.abs(m.diamondRp - 2.55) < 0.001, '1 diamond ~ Rp 2,55');
  assert.equal(m.hostShare, 0.3);
  assert.equal(m.agencyRate, 0.1);
  // bayar host+agency = 0,4 x 1,55 = Rp 0,62 per koin
  assert.ok(Math.abs(m.worst.payout - 1.02) < 0.001);
  // bersih terburuk = 2 / 1,11 x 0,7 = Rp 1,26
  assert.ok(Math.abs(m.worst.net - 1.2613) < 0.001);
  assert.ok(m.worst.profit > 0.23 && m.worst.profit < 0.25, `untung terburuk ${m.worst.profit}`);
  assert.ok(m.best.profit > m.worst.profit, 'potongan 15% lebih untung');
  assert.equal((await api('GET', '/api/admin/margin', { token: 'x' })).status, 401);
});

test('pengaturan yang membuat rugi ditolak dan tidak tersimpan', async () => {
  // nilai diamond jadi Rp 5,67 -> bayar jauh di atas pemasukan
  const bad = await A('PATCH', '/api/admin/settings', { withdraw_diamonds_per_usd: 3000 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'NEGATIVE_MARGIN');
  assert.match(bad.body.error.message, /rugi/);
  assert.match(bad.body.error.message, /potongan Google Play 30%/);
  assert.equal(await setting('withdraw_diamonds_per_usd'), 6667, 'tidak berubah');

  // bagian host 90% juga rugi; 35% masih aman
  assert.equal((await A('PATCH', '/api/admin/settings', { host_share: 0.9 })).body.error.code, 'NEGATIVE_MARGIN');
  assert.equal((await A('PATCH', '/api/admin/settings', { host_share: 0.35 })).status, 200);
  assert.ok((await A('GET', '/api/admin/margin')).body.worst.profit > 0.1);
  await A('PATCH', '/api/admin/settings', { host_share: 0.3 });

  // kurs rupiah per USD yang jauh lebih tinggi berarti diamond jauh lebih mahal
  assert.equal((await A('PATCH', '/api/admin/settings', { withdraw_usd_idr: 60000 })).body.error.code, 'NEGATIVE_MARGIN');
});

test('paket koin yang terlalu murah ditolak (ubah, tambah), dan tidak ada yang berubah', async () => {
  const pk = (await A('GET', '/api/admin/packages')).body;
  const first = pk[0];
  const cheap = await A('PATCH', `/api/admin/packages/${first.id}`, { priceIdr: 1000, priceUsdCents: 6 });
  assert.equal(cheap.status, 400);
  assert.equal(cheap.body.error.code, 'NEGATIVE_MARGIN');
  assert.equal((await A('GET', '/api/admin/packages')).body[0].priceIdr, 36000, 'harga tidak berubah');

  const add = await A('POST', '/api/admin/packages', { coins: 100000, priceIdr: 5000, priceUsdCents: 30 });
  assert.equal(add.body.error.code, 'NEGATIVE_MARGIN');
  assert.equal((await A('GET', '/api/admin/packages')).body.length, pk.length, 'paket tidak ditambah');

  // harga yang wajar tetap boleh, termasuk diskon kecil di paket besar
  const ok = await A('PATCH', `/api/admin/packages/${pk[7].id}`, { priceIdr: 3400000, priceUsdCents: 20000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await A('PATCH', `/api/admin/packages/${pk[7].id}`, { priceIdr: 3600000, priceUsdCents: 21176 });
});

test('komisi agency terlalu besar ditolak walau masih di bawah batas teknis', async () => {
  // batas teknis = 1 - bagian host = 0,7; tapi 0,6 sudah membuat rugi
  const rakus = await A('POST', '/api/admin/agencies', { name: 'Rakus', commissionRate: 0.6 });
  assert.equal(rakus.status, 400);
  assert.equal(rakus.body.error.code, 'NEGATIVE_MARGIN');
  const ok = await A('POST', '/api/admin/agencies', { name: 'Wajar', commissionRate: 0.15 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const up = await A('PATCH', `/api/admin/agencies/${ok.body.id}`, { commissionRate: 0.6 });
  assert.equal(up.body.error.code, 'NEGATIVE_MARGIN');
  assert.equal((await A('GET', '/api/admin/agencies')).body.find((a) => a.id === ok.body.id).commissionRate, 0.15);
  const m = (await A('GET', '/api/admin/margin')).body;
  assert.equal(m.agencyRate, 0.15, 'margin memakai komisi agency tertinggi yang aktif');
  await A('PATCH', `/api/admin/agencies/${ok.body.id}`, { active: false });
});

test('kondisi yang sudah rugi: perbaikan & pengaturan lain boleh, memperburuk tidak', async () => {
  // paksa kondisi rugi langsung di database (mis. data lama)
  await db.query(`INSERT INTO settings (key, value) VALUES ('withdraw_diamonds_per_usd', '3000') ON CONFLICT (key) DO UPDATE SET value = '3000'`);
  assert.ok((await A('GET', '/api/admin/margin')).body.worst.profit < 0);

  assert.equal((await A('PATCH', '/api/admin/settings', { chat_price_max: 9000 })).status, 200, 'pengaturan lain tidak diblokir');
  assert.equal((await A('PATCH', '/api/admin/settings', { withdraw_diamonds_per_usd: 2000 })).body.error.code, 'NEGATIVE_MARGIN', 'memperburuk ditolak');
  const fix = await A('PATCH', '/api/admin/settings', { withdraw_diamonds_per_usd: 6667 });
  assert.equal(fix.status, 200, 'memperbaiki boleh');
  assert.ok((await A('GET', '/api/admin/margin')).body.worst.profit > 0);
});

test('gift pengali x2: bagian host 10% -> 20%, diamond host sesuai, dan pengali terlalu besar ditolak', async () => {
  const gifts = (await A('GET', '/api/admin/gifts')).body;
  const mk = await A('POST', '/api/admin/gifts', { name: 'Mahkota', price: 1000000, hostMultiplier: 2 });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  assert.equal(mk.body.hostMultiplier, 2);
  assert.equal((await A('POST', '/api/admin/gifts', { name: 'Biasa', price: 1000 })).body.hostMultiplier, 1);
  assert.equal((await A('POST', '/api/admin/gifts', { name: 'X9', price: 1000, hostMultiplier: 9 })).status, 400);
  void gifts;

  // gift host 10% x 2 = 20% masih di bawah jalur chat 30%, jadi margin tidak berubah
  assert.equal((await A('GET', '/api/admin/margin')).body.giftMultiplier, 2);
  // bagian gift 40% x2 = 80% -> rugi, ditolak
  assert.equal((await A('PATCH', '/api/admin/settings', { gift_host_share: 0.4 })).body.error.code, 'NEGATIVE_MARGIN');
  // pengali x5 pada gift 10% = 50% -> rugi, ditolak dan tidak tersimpan
  const up = await A('PATCH', `/api/admin/gifts/${mk.body.id}`, { hostMultiplier: 5 });
  assert.equal(up.body.error.code, 'NEGATIVE_MARGIN');
  assert.equal((await A('GET', '/api/admin/gifts')).body.find((g) => g.id === mk.body.id).hostMultiplier, 2);
});

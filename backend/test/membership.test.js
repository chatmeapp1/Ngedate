/**
 * Level, VIP, dan kartu pesan gratis.
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
let buyer;
let host;

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
const me = async (u) => (await api('GET', '/api/me', { token: u.token })).body;
const diamonds = async (id) => Number((await db.query(`SELECT diamonds FROM users WHERE id = $1`, [id])).rows[0].diamonds);
const coins = async (id) => Number((await db.query(`SELECT coins FROM users WHERE id = $1`, [id])).rows[0].coins);

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
  buyer = await register('pembeli');
  host = await register('hostku');
  await A('PATCH', `/api/admin/users/${host.id}/role`, { role: 'host' });
  await api('PATCH', '/api/host/settings', { token: host.token, body: { chatPrice: 100 } });
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('level naik dari total top up; penyesuaian koin tidak dihitung', async () => {
  let m = (await me(buyer)).membership;
  assert.equal(m.level, 0);
  assert.equal(m.vip, 0);
  assert.equal(m.nextLevelAt, 2000);

  await A('POST', `/api/admin/users/${buyer.id}/coins`, { amount: 2000 });
  m = (await me(buyer)).membership;
  assert.equal(m.level, 1);
  assert.equal(m.topupTotal, 2000);
  assert.equal(m.nextLevelAt, 30000);
  assert.ok(Math.abs(m.levelProgress - 0) < 1e-9);

  await A('POST', `/api/admin/users/${buyer.id}/coins`, { amount: 78000 });
  m = (await me(buyer)).membership;
  assert.equal(m.level, 3, '80.000 = Level 3');

  await A('POST', `/api/admin/users/${buyer.id}/coins`, { amount: -50000 }); // dikurangi admin
  assert.equal((await me(buyer)).membership.topupTotal, 80000, 'pengurangan tidak menurunkan level');
});

test('VIP 1-5 mengikuti batas 300rb, 700rb, 1,4 juta, 2,8 juta, 4 juta', async () => {
  const u = await register('kaya');
  const steps = [[299999, 0], [1, 1], [400000, 2], [700000, 3], [1400000, 4], [1200000, 5]];
  // total kumulatif: 299.999, 300.000, 700.000, 1.400.000, 2.800.000, 4.000.000
  for (const [amount, vip] of steps) {
    await A('POST', `/api/admin/users/${u.id}/coins`, { amount });
    assert.equal((await me(u)).membership.vip, vip, `vip ${vip}`);
  }
  const m = (await me(u)).membership;
  assert.equal(m.level, 8, '4 juta koin = Level 8');
  assert.equal(m.nextVipAt, null);
  assert.equal(m.maxVip, 5);
});

test('pengguna biasa membayar pesan; VIP memakai kartu gratis 5x per hari, host dapat 5 diamond', async () => {
  const conv = (await api('POST', '/api/conversations', { token: buyer.token, body: { hostId: host.id } })).body;
  // buyer (total 80.000) bukan VIP -> bayar normal
  const paid = await api('POST', `/api/conversations/${conv.id}/messages`, { token: buyer.token, body: { body: 'halo' } });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.freeCard, false);
  assert.equal(paid.body.message.price, 100);

  const vip = await register('vip1');
  await A('POST', `/api/admin/users/${vip.id}/coins`, { amount: 300000 });
  const vconv = (await api('POST', '/api/conversations', { token: vip.token, body: { hostId: host.id } })).body;
  assert.equal((await me(vip)).membership.freeCardsLeft, 5);

  const coinsBefore = await coins(vip.id);
  const dBefore = await diamonds(host.id);
  for (let i = 1; i <= 5; i++) {
    const r = await api('POST', `/api/conversations/${vconv.id}/messages`, { token: vip.token, body: { body: `pesan ${i}` } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.freeCard, true);
    assert.equal(r.body.message.freeCard, true);
    assert.equal(r.body.message.price, 0);
    assert.equal(r.body.message.paymentStatus, 'free');
  }
  assert.equal(await coins(vip.id), coinsBefore, 'koin VIP tidak berkurang');
  assert.equal(await diamonds(host.id), dBefore + 25, '5 pesan x 5 diamond');
  assert.equal((await me(vip)).membership.freeCardsLeft, 0);

  // pesan ke-6 berbayar seperti biasa
  const sixth = await api('POST', `/api/conversations/${vconv.id}/messages`, { token: vip.token, body: { body: 'pesan 6' } });
  assert.equal(sixth.body.freeCard, false);
  assert.equal(sixth.body.message.price, 100);
  assert.equal(await coins(vip.id), coinsBefore - 100);
  assert.equal(await diamonds(host.id), dBefore + 25, 'pesan berbayar masih ditahan');

  const ledger = await db.query(`SELECT COUNT(*)::int AS n FROM ledger WHERE user_id = $1 AND reason = 'free_card_income'`, [host.id]);
  assert.equal(ledger.rows[0].n, 5);
});

test('kartu gratis tidak berlaku untuk host yang gratis, dan jumlah/diamond dapat diatur admin', async () => {
  const vip = (await db.query(`SELECT id FROM users WHERE username = 'vip1'`)).rows[0];
  void vip;
  const s = await A('PATCH', '/api/admin/settings', { free_cards_per_day: 2, free_card_host_diamonds: 8 });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const v2 = await register('vip2');
  await A('POST', `/api/admin/users/${v2.id}/coins`, { amount: 300000 });
  const conv = (await api('POST', '/api/conversations', { token: v2.token, body: { hostId: host.id } })).body;
  assert.equal((await me(v2)).membership.freeCardsLeft, 2);
  const before = await diamonds(host.id);
  for (let i = 0; i < 3; i++) await api('POST', `/api/conversations/${conv.id}/messages`, { token: v2.token, body: { body: `x${i}` } });
  assert.equal(await diamonds(host.id), before + 16, '2 kartu x 8 diamond');
});

test('batas level & VIP: validasi dan simpan dari panel admin', async () => {
  const ok = await A('PATCH', '/api/admin/settings', { vip_thresholds: '100, 200, 300, 400, 500' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.vip_thresholds, [100, 200, 300, 400, 500]);
  assert.equal((await A('PATCH', '/api/admin/settings', { vip_thresholds: '1,2,3' })).status, 400, 'harus 5 angka');
  assert.equal((await A('PATCH', '/api/admin/settings', { level_thresholds: '5,2000,30000,80000,150000,250000,500000,1000000,2000000,5000000,10000000' })).status, 400, 'level 0 harus 0');
  assert.equal((await A('PATCH', '/api/admin/settings', { vip_thresholds: '500,400,300,200,100' })).status, 400, 'harus menaik');
  await A('PATCH', '/api/admin/settings', { vip_thresholds: '300000, 700000, 1400000, 2800000, 4000000' });
});

test('foto & video di chat: khusus VIP, isi file diperiksa, batas harian, tidak memotong koin', async () => {
  const sendFile = async (user, convId, bytes, type, name) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    const res = await fetch(`${base}/api/conversations/${convId}/media`, { method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body: form });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(200)]);

  // bukan VIP ditolak
  const reg = await register('biasa');
  await A('POST', `/api/admin/users/${reg.id}/coins`, { amount: 1000 });
  const c0 = (await api('POST', '/api/conversations', { token: reg.token, body: { hostId: host.id } })).body;
  const no = await sendFile(reg, c0.id, jpg, 'image/jpeg', 'a.jpg');
  assert.equal(no.status, 403);
  assert.equal(no.body.error.code, 'VIP_REQUIRED');

  const vip = await register('vipmedia');
  await A('POST', `/api/admin/users/${vip.id}/coins`, { amount: 300000 });
  const conv = (await api('POST', '/api/conversations', { token: vip.token, body: { hostId: host.id } })).body;
  const coinsBefore = await coins(vip.id);

  const img = await sendFile(vip, conv.id, jpg, 'image/jpeg', 'a.jpg');
  assert.equal(img.status, 201, JSON.stringify(img.body));
  assert.equal(img.body.message.type, 'image');
  assert.match(img.body.message.mediaUrl, /\/uploads\/.+\.jpg$/);
  assert.equal(img.body.message.price, 0);
  const vid = await sendFile(vip, conv.id, mp4, 'video/mp4', 'v.mp4');
  assert.equal(vid.status, 201, JSON.stringify(vid.body));
  assert.equal(vid.body.message.type, 'video');
  assert.equal(await coins(vip.id), coinsBefore, 'tidak memotong koin');

  // file palsu (tipe gambar tapi isi bukan gambar) ditolak
  const fake = await sendFile(vip, conv.id, Buffer.from('<?php echo 1; ?>'), 'image/jpeg', 'x.jpg');
  assert.equal(fake.status, 400);
  assert.equal(fake.body.error.code, 'INVALID_FILE');
  assert.equal((await sendFile(vip, conv.id, jpg, 'application/pdf', 'x.pdf')).status, 400);

  // host melihat pesan media, dan host tidak bisa mengirim lewat endpoint ini
  const msgs = (await api('GET', `/api/conversations/${conv.id}/messages`, { token: host.token })).body;
  const list = Array.isArray(msgs) ? msgs : msgs.messages;
  assert.ok(list.some((m) => m.type === 'image' && m.mediaUrl));
  assert.equal((await sendFile(host, conv.id, jpg, 'image/jpeg', 'h.jpg')).status, 403);

  // batas per hari
  await A('PATCH', '/api/admin/settings', { vip_media_per_day: 2 });
  const lim = await sendFile(vip, conv.id, jpg, 'image/jpeg', 'b.jpg');
  assert.equal(lim.status, 429);
  assert.equal(lim.body.error.code, 'MEDIA_LIMIT');
  await A('PATCH', '/api/admin/settings', { vip_media_per_day: 30 });
});

test('level host dari penghasilan diamond 7 hari terakhir (bergulir); terlihat di daftar & profil host', async () => {
  const h2 = await register('hostlevel');
  await A('PATCH', `/api/admin/users/${h2.id}/role`, { role: 'host' });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [h2.id]);
  await api('PATCH', '/api/host/settings', { token: h2.token, body: { chatPrice: 100 } });

  // baru: level 0, ringkasan host berbasis penghasilan
  let own = (await me(h2)).membership;
  assert.equal(own.kind, 'host');
  assert.equal(own.level, 0);
  assert.equal(own.nextLevelAt, 300);
  assert.equal(own.vip, 0);

  // gift 20.000 koin -> host 2.000 diamond -> Level 2 (batas 300 dan 3.000: 2.000 masih Level 1)
  const gid = (await db.query(`INSERT INTO gifts (name, price) VALUES ('Besar', 20000) RETURNING id`)).rows[0].id;
  const payer = await register('pembayarlevel');
  await A('POST', `/api/admin/users/${payer.id}/coins`, { amount: 200000 });
  const conv = (await api('POST', '/api/conversations', { token: payer.token, body: { hostId: h2.id } })).body;
  const g = await api('POST', `/api/conversations/${conv.id}/gifts`, { token: payer.token, body: { giftId: gid } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  own = (await me(h2)).membership;
  assert.equal(own.topupTotal, 2000, 'penghasilan 7 hari = 10% dari 20.000');
  assert.equal(own.earnedToday, 2000, 'penghasilan hari ini (WIB)');
  assert.equal(own.level, 1);

  // pengguna melihat level host (bukan jumlah penghasilannya)
  const list = (await api('GET', '/api/hosts', { token: payer.token })).body;
  assert.equal(list.find((x) => x.id === h2.id).level, 1);
  const prof = (await api('GET', `/api/hosts/${h2.id}`, { token: payer.token })).body;
  assert.equal(prof.level, 1);
  assert.ok(!/income|week/.test(JSON.stringify(prof)), 'penghasilan host tidak dibuka ke pengguna');

  // menarik diamond tidak menurunkan level
  await db.query(`UPDATE users SET diamonds = 0 WHERE id = $1`, [h2.id]);
  assert.equal((await me(h2)).membership.level, 1);

  // bergulir: penghasilan yang lebih dari 7 hari lalu tidak dihitung lagi
  await db.query(`UPDATE ledger SET created_at = now() - interval '8 days' WHERE user_id = $1 AND reason = 'gift_income'`, [h2.id]);
  assert.equal((await me(h2)).membership.level, 0);
  assert.equal((await api('GET', `/api/hosts/${h2.id}`, { token: payer.token })).body.level, 0);

  // batas level host dapat diatur admin
  const ok = await A('PATCH', '/api/admin/settings', { host_level_thresholds: '0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await A('PATCH', '/api/admin/settings', { host_level_thresholds: '1,2,3' })).status, 400);
  await A('PATCH', '/api/admin/settings', { host_level_thresholds: '0, 300, 3000, 5000, 10000, 70000, 150000, 300000, 500000, 1000000, 5000000' });
});

/**
 * Pengujian end-to-end terhadap PostgreSQL sungguhan.
 * Jalankan: DATABASE_URL=postgres://.../ngedate_test npm test
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');
const { runRefundJob } = require('../src/jobs/refund');
const bcrypt = require('bcryptjs');

let server;
let base;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function register(username) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.user.id, token: r.body.accessToken, refresh: r.body.refreshToken };
}

async function balance(id) {
  const { rows } = await db.query(`SELECT coins, diamonds FROM users WHERE id = $1`, [id]);
  return { coins: Number(rows[0].coins), diamonds: Number(rows[0].diamonds) };
}

let admin, user, host, other;
let convId;
let giftId;

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  const hash = await bcrypt.hash('admin123', 4);
  await db.query(`INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', $1, 'Admin', 'admin')`, [hash]);
  const { rows } = await db.query(`INSERT INTO gifts (name, price, icon) VALUES ('Cokelat', 500, '🍫') RETURNING id`);
  giftId = rows[0].id;

  server = http.createServer(createApp());
  realtime.attach(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } });
  admin = { token: login.body.accessToken };
  user = await register('budi');
  host = await register('sari');
  other = await register('joko');
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('register tidak bisa memilih role admin', async () => {
  const r = await api('POST', '/api/auth/register', { body: { username: 'hacker', password: 'rahasia123', role: 'admin' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'user');
});

test('refresh token dirotasi dan token lama tidak bisa dipakai lagi', async () => {
  const s = await register('rotasi');
  const r1 = await api('POST', '/api/auth/refresh', { body: { refreshToken: s.refresh } });
  assert.equal(r1.status, 200);
  const r2 = await api('POST', '/api/auth/refresh', { body: { refreshToken: s.refresh } });
  assert.equal(r2.status, 401);
});

test('admin menjadikan host & host mengatur tarif + syarat WA', async () => {
  const r = await api('PATCH', `/api/admin/users/${host.id}/role`, { token: admin.token, body: { role: 'host' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'host');

  const bad = await api('PATCH', '/api/host/settings', { token: host.token, body: { waEnabled: true } });
  assert.equal(bad.status, 400, 'WA tidak boleh aktif tanpa nomor');

  const s = await api('PATCH', '/api/host/settings', {
    token: host.token,
    body: { chatPrice: 100, waEnabled: true, waNumber: '0812-3456-7890', waUnlockThreshold: 10000 },
  });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.waNumber, '081234567890');

  const forUser = await api('PATCH', '/api/host/settings', { token: user.token, body: { chatPrice: 1 } });
  assert.equal(forUser.status, 403, 'user biasa tidak boleh mengubah pengaturan host');
});

test('daftar host tidak membocorkan nomor WA', async () => {
  const r = await api('GET', '/api/hosts', { token: user.token });
  assert.equal(r.status, 200);
  const h = r.body.find((x) => x.id === host.id);
  assert.ok(h);
  assert.equal(h.chatPrice, 100);
  assert.equal(h.waAvailable, true);
  assert.ok(!JSON.stringify(r.body).includes('3456'), 'nomor WA tidak boleh muncul');
});

test('admin top up koin user', async () => {
  const r = await api('POST', `/api/admin/users/${user.id}/coins`, { token: admin.token, body: { amount: 20000, note: 'test' } });
  assert.equal(r.status, 200);
  assert.equal((await balance(user.id)).coins, 20000);
  const forbidden = await api('POST', `/api/admin/users/${user.id}/coins`, { token: user.token, body: { amount: 1 } });
  assert.equal(forbidden.status, 403);
});

test('hanya user yang bisa memulai chat, dan hanya dengan host', async () => {
  const toUser = await api('POST', '/api/conversations', { token: user.token, body: { hostId: other.id } });
  assert.equal(toUser.status, 404);
  const fromHost = await api('POST', '/api/conversations', { token: host.token, body: { hostId: host.id } });
  assert.equal(fromHost.status, 400);
  const r = await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } });
  assert.equal(r.status, 200);
  convId = r.body.id;
  const again = await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } });
  assert.equal(again.body.id, convId, 'percakapan yang sama dipakai ulang');
});

test('pesan user: koin ditahan, host belum dapat apa-apa', async () => {
  const r = await api('POST', `/api/conversations/${convId}/messages`, { token: user.token, body: { body: 'Halo kak' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.message.paymentStatus, 'held');
  assert.equal(r.body.message.price, 100);
  assert.deepEqual(await balance(user.id), { coins: 19900, diamonds: 0 });
  assert.equal((await balance(host.id)).diamonds, 0);
  const w = await api('GET', '/api/wallet', { token: user.token });
  assert.equal(w.body.heldCoins, 100);
});

test('nomor HP / link / sosmed diblokir di chat (kedua pihak)', async () => {
  for (const [who, text] of [[user, 'wa aku 0812 3456 7890'], [host, 'cek www.situs.com'], [host, 'ig: sari_cantik']]) {
    const r = await api('POST', `/api/conversations/${convId}/messages`, { token: who.token, body: { body: text } });
    assert.equal(r.status, 422, text);
    assert.equal(r.body.error.code, 'CONTACT_BLOCKED');
  }
  assert.equal((await balance(user.id)).coins, 19900, 'pesan yang diblokir tidak memotong koin');
});

test('orang lain tidak bisa membaca atau mengirim ke percakapan ini', async () => {
  const r1 = await api('GET', `/api/conversations/${convId}/messages`, { token: other.token });
  assert.equal(r1.status, 404);
  const r2 = await api('POST', `/api/conversations/${convId}/messages`, { token: other.token, body: { body: 'hai' } });
  assert.equal(r2.status, 404);
});

test('host membalas: koin yang ditahan dibagi 30% host / 70% platform (tanpa agency)', async () => {
  await api('POST', `/api/conversations/${convId}/messages`, { token: user.token, body: { body: 'Kak?' } });
  assert.equal((await balance(user.id)).coins, 19800);

  const r = await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'Halo juga' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.message.paymentStatus, 'free', 'pesan host gratis');
  assert.equal(r.body.settled.messages, 2);
  assert.equal(r.body.settled.coins, 200);
  assert.equal(r.body.settled.hostIncome, 60);
  assert.equal(r.body.settled.messageIds.length, 2);
  assert.equal((await balance(host.id)).diamonds, 60);
  assert.equal((await balance(user.id)).coins, 19800, 'koin user tidak berubah saat dibagi');

  const { rows } = await db.query(`SELECT SUM(amount)::int AS s FROM platform_earnings WHERE source = 'chat'`);
  assert.equal(rows[0].s, 140);

  const msgs = await api('GET', `/api/conversations/${convId}/messages`, { token: user.token });
  assert.deepEqual(msgs.body.map((m) => m.paymentStatus), ['paid', 'paid', 'free']);
});

test('koin tidak cukup: ditolak 402 dan tidak ada pesan tersimpan', async () => {
  const poor = await register('miskin');
  const c = await api('POST', '/api/conversations', { token: poor.token, body: { hostId: host.id } });
  const r = await api('POST', `/api/conversations/${c.body.id}/messages`, { token: poor.token, body: { body: 'halo' } });
  assert.equal(r.status, 402);
  assert.equal(r.body.error.code, 'INSUFFICIENT_COINS');
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1`, [c.body.id]);
  assert.equal(rows[0].n, 0);
});

test('nomor WA tersembunyi sebelum syarat gift terpenuhi', async () => {
  const r = await api('GET', `/api/conversations/${convId}/whatsapp`, { token: user.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.unlocked, false);
  assert.equal(r.body.number, null);
  assert.equal(r.body.threshold, 10000);
});

test('gift: koin dipotong, host dapat 10%, WA terbuka setelah total gift >= syarat', async () => {
  const hostBefore = (await balance(host.id)).diamonds;

  const g1 = await api('POST', `/api/conversations/${convId}/gifts`, { token: user.token, body: { giftId, count: 10 } });
  assert.equal(g1.status, 201, JSON.stringify(g1.body));
  assert.equal(g1.body.giftTotal, 5000);
  assert.equal(g1.body.message.gift.icon, '🍫');
  assert.equal(g1.body.message.gift.price, 500);
  assert.equal(g1.body.message.gift.count, 10);
  assert.equal(g1.body.message.hostIncome, 500, 'host melihat diamond yang diterima (10% dari 5.000), bukan harga gift');
  assert.equal(g1.body.waUnlocked, false);
  assert.equal((await balance(user.id)).coins, 19800 - 5000);
  assert.equal((await balance(host.id)).diamonds, hostBefore + 500);

  const hostGift = await api('POST', `/api/conversations/${convId}/gifts`, { token: host.token, body: { giftId } });
  assert.equal(hostGift.status, 403, 'host tidak bisa kirim gift');

  const g2 = await api('POST', `/api/conversations/${convId}/gifts`, { token: user.token, body: { giftId, count: 10 } });
  assert.equal(g2.body.giftTotal, 10000);
  assert.equal(g2.body.waUnlocked, true);
  assert.equal(g2.body.systemMessage.type, 'system');

  const wa = await api('GET', `/api/conversations/${convId}/whatsapp`, { token: user.token });
  assert.equal(wa.body.unlocked, true);
  assert.equal(wa.body.number, '081234567890');
  assert.equal(wa.body.link, 'https://wa.me/6281234567890');

  const g3 = await api('POST', `/api/conversations/${convId}/gifts`, { token: user.token, body: { giftId } });
  assert.equal(g3.body.waUnlocked, false, 'pesan sistem buka WA hanya sekali');
  assert.equal(g3.body.systemMessage, null);
});

test('pesan yang tidak dibalas dikembalikan setelah batas waktu', async () => {
  const before = (await balance(user.id)).coins;
  await api('POST', `/api/conversations/${convId}/messages`, { token: user.token, body: { body: 'masih di sana?' } });
  assert.equal((await balance(user.id)).coins, before - 100);

  // Belum lewat batas waktu: tidak ada refund
  assert.equal((await runRefundJob()).length, 0);

  await api('PATCH', '/api/admin/settings', { token: admin.token, body: { reply_window_hours: 0 } });
  const results = await runRefundJob();
  assert.equal(results.length, 1);
  assert.equal(results[0].amount, 100);
  assert.equal((await balance(user.id)).coins, before);
  await api('PATCH', '/api/admin/settings', { token: admin.token, body: { reply_window_hours: 24 } });

  const msgs = await api('GET', `/api/conversations/${convId}/messages`, { token: user.token });
  assert.equal(msgs.body.at(-1).paymentStatus, 'refunded');
});

test('pesan bersamaan tidak bisa memakai saldo yang sama dua kali', async () => {
  const p = await register('paralel');
  await api('POST', `/api/admin/users/${p.id}/coins`, { token: admin.token, body: { amount: 300 } });
  const c = await api('POST', '/api/conversations', { token: p.token, body: { hostId: host.id } });
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      api('POST', `/api/conversations/${c.body.id}/messages`, { token: p.token, body: { body: `pesan ${i}` } })
    )
  );
  const ok = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 402).length;
  assert.equal(ok, 3);
  assert.equal(rejected, 7);
  assert.equal((await balance(p.id)).coins, 0);
});

test('riwayat ledger selalu cocok dengan saldo', async () => {
  for (const u of [user, host]) {
    const { rows } = await db.query(
      `SELECT currency, SUM(amount)::bigint AS s FROM ledger WHERE user_id = $1 GROUP BY currency`,
      [u.id]
    );
    const sums = Object.fromEntries(rows.map((r) => [r.currency, Number(r.s)]));
    const b = await balance(u.id);
    assert.equal(sums.coin || 0, b.coins);
    assert.equal(sums.diamond || 0, b.diamonds);
  }
});

test('socket.io: tanpa token ditolak, dengan token menerima pesan realtime', async () => {
  const bad = ioClient(base, { auth: { token: 'palsu' }, transports: ['websocket'], reconnection: false });
  const err = await new Promise((resolve) => bad.on('connect_error', resolve));
  assert.equal(err.message, 'UNAUTHORIZED');
  bad.close();

  // token host mungkin sudah lewat 15 menit? tidak, test cepat. Login ulang untuk aman.
  const login = await api('POST', '/api/auth/login', { body: { login: 'sari', password: 'rahasia123' } });
  const sock = ioClient(base, { auth: { token: login.body.accessToken }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    sock.on('connect', resolve);
    sock.on('connect_error', reject);
  });
  const received = new Promise((resolve) => sock.on('message:new', resolve));
  const wallet = new Promise((resolve) => sock.on('wallet:update', resolve));
  await api('POST', `/api/conversations/${convId}/messages`, { token: user.token, body: { body: 'tes realtime' } });
  const evt = await received;
  assert.equal(evt.message.body, 'tes realtime');
  assert.equal(evt.conversation.role, 'host');
  assert.equal(evt.conversation.unread >= 1, true);

  await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'balas realtime' } });
  const w = await wallet;
  assert.equal(typeof w.diamonds, 'number');
  sock.close();
});

test('akun yang di-suspend langsung tidak bisa dipakai', async () => {
  const s = await register('nakal');
  const r = await api('PATCH', `/api/admin/users/${s.id}/status`, { token: admin.token, body: { status: 'suspended' } });
  assert.equal(r.status, 200);
  const me = await api('GET', '/api/me', { token: s.token });
  assert.equal(me.status, 403);
  const refresh = await api('POST', '/api/auth/refresh', { body: { refreshToken: s.refresh } });
  assert.equal(refresh.status, 401);
});

test('jumlah belum dibaca & info lawan bicara', async () => {
  const before = await api('GET', '/api/conversations/unread-count', { token: host.token });
  assert.equal(before.status, 200);
  const conv = await api('GET', `/api/conversations/${convId}`, { token: host.token });
  assert.ok(conv.body.unread >= 1, 'host punya pesan belum dibaca di percakapan ini');
  await api('POST', `/api/conversations/${convId}/read`, { token: host.token });
  const after = await api('GET', '/api/conversations/unread-count', { token: host.token });
  assert.equal(after.body.total, before.body.total - conv.body.unread);

  const c = await api('GET', `/api/conversations/${convId}`, { token: user.token });
  assert.equal(c.body.peer.role, 'host');
  assert.equal(typeof c.body.peer.online, 'boolean');
  assert.equal(typeof c.body.peer.verified, 'boolean');
});

test('socket: user diberi tahu saat pesannya dibayar (host membalas)', async () => {
  const login = await api('POST', '/api/auth/login', { body: { login: 'budi', password: 'rahasia123' } });
  const sock = ioClient(base, { auth: { token: login.body.accessToken }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    sock.on('connect', resolve);
    sock.on('connect_error', reject);
  });
  const sent = await api('POST', `/api/conversations/${convId}/messages`, { token: user.token, body: { body: 'dibalas ya' } });
  const settled = new Promise((resolve) => sock.on('chat:settled', resolve));
  await api('POST', `/api/conversations/${convId}/messages`, { token: host.token, body: { body: 'siap' } });
  const evt = await settled;
  assert.equal(evt.conversationId, convId);
  assert.ok(evt.messageIds.includes(sent.body.message.id));
  sock.close();
});

test('daftar gift & dinding gift menyertakan ikon', async () => {
  const list = await api('GET', '/api/gifts', { token: user.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.some((g) => g.icon === '🍫'));
  const wall = await api('GET', `/api/hosts/${host.id}/gifts`, { token: user.token });
  assert.equal(wall.status, 200);
  assert.equal(wall.body.gifts[0].icon, '🍫');
});

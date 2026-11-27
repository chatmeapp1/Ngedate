/**
 * Papan peringkat: host berpenghasilan terbanyak dan pengirim gift terbanyak.
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
const A = (method, p, body) => api(method, p, { token: admin, body });
const register = async (name) => {
  const r = await api('POST', '/api/auth/register', { body: { username: name, password: 'rahasia123', displayName: name } });
  return { id: r.body.user.id, token: r.body.accessToken };
};
async function makeHost(name) {
  const h = await register(name);
  await A('PATCH', `/api/admin/users/${h.id}/role`, { role: 'host' });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [h.id]);
  return h;
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
  admin = (await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } })).body.accessToken;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('peringkat host (penghasilan) dan pengirim gift (belanja koin), mingguan dan semua waktu', async () => {
  const h1 = await makeHost('hostjuara');
  const h2 = await makeHost('hostkedua');
  const rich = await register('sultan');
  const mid = await register('menengah');
  for (const u of [rich, mid]) await A('POST', `/api/admin/users/${u.id}/coins`, { amount: 1000000 });
  const gid = (await db.query(`INSERT INTO gifts (name, price) VALUES ('Mawar', 1000) RETURNING id`)).rows[0].id;
  const send = async (user, host, count) => {
    const conv = (await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } })).body;
    const r = await api('POST', `/api/conversations/${conv.id}/gifts`, { token: user.token, body: { giftId: gid, count } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  };
  await send(rich, h1, 50); // 50.000 koin -> host 5.000 diamond
  await send(mid, h1, 10); // 10.000 koin -> host 1.000
  await send(mid, h2, 5); // 5.000 koin -> host 500

  const hosts = (await api('GET', '/api/rankings?type=hosts&period=week', { token: rich.token })).body;
  assert.deepEqual(hosts.items.map((x) => [x.displayName, x.score, x.rank]), [['hostjuara', 6000, 1], ['hostkedua', 500, 2]]);

  const senders = (await api('GET', '/api/rankings?type=senders&period=week', { token: rich.token })).body;
  assert.deepEqual(senders.items.map((x) => [x.displayName, x.score]), [['sultan', 50000], ['menengah', 15000]]);
  assert.ok(!('username' in senders.items[0]) && !('coins' in senders.items[0]), 'tidak membocorkan data lain');

  // 7 hari terakhir vs semua waktu: yang lebih lama dari 7 hari tidak masuk mingguan
  await db.query(`UPDATE ledger SET created_at = now() - interval '9 days' WHERE reason = 'gift_income' AND user_id = $1`, [h1.id]);
  await db.query(`UPDATE messages SET created_at = now() - interval '9 days' WHERE type = 'gift' AND sender_id = $1`, [rich.id]);
  const week = (await api('GET', '/api/rankings?type=hosts&period=week', { token: rich.token })).body;
  assert.deepEqual(week.items.map((x) => x.displayName), ['hostkedua'], 'hostjuara keluar dari peringkat mingguan');
  const all = (await api('GET', '/api/rankings?type=hosts&period=all', { token: rich.token })).body;
  assert.equal(all.items[0].displayName, 'hostjuara');
  const sw = (await api('GET', '/api/rankings?type=senders&period=week', { token: rich.token })).body;
  assert.deepEqual(sw.items.map((x) => x.displayName), ['menengah']);

  // gift tunggal terbesar: pengirim -> gift -> host
  await db.query(`UPDATE messages SET created_at = now() WHERE type = 'gift'`);
  const gifts = (await api('GET', '/api/rankings?type=gifts&period=week', { token: rich.token })).body;
  assert.deepEqual(gifts.items.map((x) => [x.sender.displayName, x.host.displayName, x.score, x.count, x.gift.name]), [
    ['sultan', 'hostjuara', 50000, 50, 'Mawar'],
    ['menengah', 'hostjuara', 10000, 10, 'Mawar'],
    ['menengah', 'hostkedua', 5000, 5, 'Mawar'],
  ]);
  assert.equal(gifts.items[0].rank, 1);

  assert.equal((await api('GET', '/api/rankings?type=hacker', { token: rich.token })).status, 400);
  assert.equal((await api('GET', '/api/rankings')).status, 401);
});

test('akun yang ditangguhkan tidak muncul di peringkat', async () => {
  await db.query(`UPDATE users SET status = 'suspended' WHERE username = 'menengah'`);
  const t = (await api('POST', '/api/auth/login', { body: { login: 'sultan', password: 'rahasia123' } })).body.accessToken;
  const sw = (await api('GET', '/api/rankings?type=senders&period=all', { token: t })).body;
  assert.ok(!sw.items.some((x) => x.displayName === 'menengah'));
});

test('orang asing: pengunjung profil host yang belum punya percakapan; terbaru dulu; jumlah kunjungan', async () => {
  const host = await makeHost('hostdilihat');
  const a = await register('pengunjunga');
  const b = await register('pengunjungb');
  const c = await register('pengunjungc');
  const seen = async (u) => api('GET', `/api/hosts/${host.id}`, { token: u.token });

  await seen(a);
  await seen(b);
  await seen(a); // a dua kali
  await api('GET', `/api/hosts/${host.id}`, { token: host.token }); // diri sendiri tidak dihitung
  await new Promise((r) => setTimeout(r, 200));

  const list = (await api('GET', '/api/members/visitors', { token: host.token })).body;
  assert.deepEqual(list.map((x) => [x.displayName, x.views]), [['pengunjunga', 2], ['pengunjungb', 1]], 'a paling baru, dihitung 2x');
  assert.ok(list[0].viewedAt);
  assert.ok(!('email' in list[0]) && !('coins' in list[0]), 'tidak membocorkan data pribadi');

  // setelah ada percakapan, tidak lagi "orang asing"
  await api('POST', '/api/conversations', { token: b.token, body: { hostId: host.id } });
  const after = (await api('GET', '/api/members/visitors', { token: host.token })).body;
  assert.deepEqual(after.map((x) => x.displayName), ['pengunjunga']);

  // diblokir host: hilang dari daftar
  await api('POST', '/api/blocks', { token: host.token, body: { userId: a.id } });
  assert.equal((await api('GET', '/api/members/visitors', { token: host.token })).body.length, 0);

  // hanya host; host lain tidak melihat daftar milik host ini
  assert.equal((await api('GET', '/api/members/visitors', { token: a.token })).status, 403);
  const other = await makeHost('hostlain');
  assert.equal((await api('GET', '/api/members/visitors', { token: other.token })).body.length, 0);
  void c;
});

test('presence: status online terbaru untuk daftar ID (butuh login, maks 100)', async () => {
  const u = await register('pengecek');
  assert.equal((await api('GET', '/api/presence?ids=1,2')).status, 401);
  const r = await api('GET', `/api/presence?ids=${u.id},999999`, { token: u.token });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), [String(u.id), '999999'].sort());
  assert.equal(r.body['999999'], false);
  assert.deepEqual((await api('GET', '/api/presence', { token: u.token })).body, {});
  const many = Array.from({ length: 101 }, (_, i) => i + 1).join(',');
  assert.equal((await api('GET', `/api/presence?ids=${many}`, { token: u.token })).status, 400);
});

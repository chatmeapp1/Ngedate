/**
 * Imbalan tugas pengguna: progres, klaim sekali, reset harian, hadiah koin.
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

const bal = async (id) => Number((await db.query(`SELECT coins FROM users WHERE id = $1`, [id])).rows[0].coins);
const tasks = async (token) => (await api('GET', '/api/user-tasks', { token })).body;
const task = (t, key) => t.tasks.find((x) => x.key === key);

test('tugas pengguna: progres dari aktivitas, klaim sekali, koin masuk, hanya untuk pengguna', async () => {
  const host = await register('hosttugas');
  await api('PATCH', `/api/admin/users/${host.id}/role`, { token: admin, body: { role: 'host' } });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [host.id]);
  const user = await register('pemtugas');
  await db.query(`UPDATE users SET coins = 1000 WHERE id = $1`, [user.id]);

  assert.equal((await api('GET', '/api/user-tasks', { token: host.token })).status, 403, 'host tidak punya tugas ini');
  let t = await tasks(user.token);
  assert.equal(task(t, 'avatar').state, 'todo');
  assert.equal((await api('POST', '/api/user-tasks/avatar/claim', { token: user.token })).status, 400, 'belum selesai');
  assert.equal((await api('POST', '/api/user-tasks/ngawur/claim', { token: user.token })).status, 404);

  // avatar
  await db.query(`UPDATE users SET avatar_url = '/uploads/a.png' WHERE id = $1`, [user.id]);
  t = await tasks(user.token);
  assert.equal(task(t, 'avatar').state, 'claimable');
  const before = await bal(user.id);
  const c = await api('POST', '/api/user-tasks/avatar/claim', { token: user.token });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.reward, 30);
  assert.equal(await bal(user.id), before + 30);
  assert.equal(task(c.body, 'avatar').state, 'done');
  assert.equal((await api('POST', '/api/user-tasks/avatar/claim', { token: user.token })).status, 409, 'tidak bisa dua kali');

  // ikuti 3 host + cocokkan lewat like/skip
  const hosts = [host];
  for (const n of ['hostb', 'hostc']) {
    const h = await register(n);
    await api('PATCH', `/api/admin/users/${h.id}/role`, { token: admin, body: { role: 'host' } });
    hosts.push(h);
  }
  for (const h of hosts) await db.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [user.id, h.id]);
  await db.query(`INSERT INTO likes (user_id, target_id) VALUES ($1, $2)`, [user.id, hosts[0].id]);
  await db.query(`INSERT INTO match_skips (user_id, host_id) VALUES ($1, $2), ($1, $3)`, [user.id, hosts[1].id, hosts[2].id]);
  t = await tasks(user.token);
  assert.equal(task(t, 'follow').state, 'claimable');
  assert.equal(task(t, 'match').state, 'claimable');
  assert.equal(task(t, 'match_day').progress, 3);
  assert.equal(task(t, 'topup').state, 'todo');
  assert.equal(task(t, 'beginner_all').progress, 1, 'baru avatar yang diklaim');

  // tugas "selesaikan semua pemula" butuh kelima tugas diklaim
  await api('POST', '/api/user-tasks/follow/claim', { token: user.token });
  await api('POST', '/api/user-tasks/match/claim', { token: user.token });
  await db.query(`UPDATE users SET topup_total = 1000000000 WHERE id = $1`, [user.id]);
  await api('POST', '/api/user-tasks/topup/claim', { token: user.token });
  t = await tasks(user.token);
  assert.equal(task(t, 'vip').state, 'claimable', 'top up besar = VIP');
  assert.equal((await api('POST', '/api/user-tasks/beginner_all/claim', { token: user.token })).status, 400);
  await api('POST', '/api/user-tasks/vip/claim', { token: user.token });
  assert.equal((await api('POST', '/api/user-tasks/beginner_all/claim', { token: user.token })).status, 200);

  // harian: gift + chat baru + like momen
  const conv = (await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } })).body;
  await api('POST', `/api/conversations/${conv.id}/messages`, { token: user.token, body: { body: 'halo' } });
  const g = (await db.query(`INSERT INTO gifts (name, price, icon) VALUES ('Mawar', 10, '🌹') RETURNING id`)).rows[0].id;
  const gs = await api('POST', `/api/conversations/${conv.id}/gifts`, { token: user.token, body: { giftId: g, count: 1 } });
  assert.equal(gs.status, 201, JSON.stringify(gs.body));
  t = await tasks(user.token);
  assert.equal(task(t, 'gift').state, 'claimable');
  assert.equal(task(t, 'chat').progress, 1);
  assert.equal(task(t, 'daily_all').progress, 0);
  const cg = await api('POST', '/api/user-tasks/gift/claim', { token: user.token });
  assert.equal(cg.status, 200);
  assert.equal(task(cg.body, 'daily_all').progress, 1);
  assert.ok(cg.body.resetIn > 0);

  // hari berikutnya: tugas harian kembali, pemula tetap selesai
  await db.query(`UPDATE user_task_claims SET period = '2000-01-01' WHERE user_id = $1 AND period <> 'once'`, [user.id]);
  t = await tasks(user.token);
  assert.equal(task(t, 'gift').state, 'claimable');
  assert.equal(task(t, 'avatar').state, 'done');
});

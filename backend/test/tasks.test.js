/**
 * Tugas host: pemula (momen, foto) dan harian (check-in, sukai).
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

const diamonds = async (u) => Number((await db.query(`SELECT diamonds FROM users WHERE id = $1`, [u.id])).rows[0].diamonds);
const list = async (u) => (await api('GET', '/api/tasks', { token: u.token })).body;
const task = (l, k) => l.tasks.find((t) => t.key === k);

test('hanya host; daftar tugas dengan progres awal', async () => {
  const user = await register('penggunatugas');
  assert.equal((await api('GET', '/api/tasks', { token: user.token })).status, 403);
  const host = await makeHost('hosttugas');
  const l = await list(host);
  assert.deepEqual(l.tasks.map((t) => [t.key, t.group, t.state]), [
    ['moment', 'beginner', 'todo'],
    ['photos', 'beginner', 'todo'],
    ['checkin', 'daily', 'claimable'],
    ['like', 'daily', 'todo'],
  ]);
  assert.deepEqual([task(l, 'moment').reward, task(l, 'photos').reward, task(l, 'checkin').reward, task(l, 'like').reward], [100, 600, 10, 20]);
  assert.ok(l.resetIn > 0 && l.resetIn <= 86400);
  assert.equal(task(l, 'like').target, 50);
  assert.equal((await api('GET', '/api/tasks')).status, 401);
});

test('check-in harian: klaim sekali sehari, diamond masuk', async () => {
  const host = await makeHost('hostcheckintugas');
  const r = await api('POST', '/api/tasks/checkin/claim', { token: host.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.reward, 10);
  assert.equal(await diamonds(host), 10);
  assert.equal(task(r.body, 'checkin').state, 'done');
  assert.equal((await api('POST', '/api/tasks/checkin/claim', { token: host.token })).status, 409);
  assert.equal(await diamonds(host), 10);
  // besok: tugas harian terbuka lagi
  await db.query(`UPDATE host_task_claims SET period = to_char((now() AT TIME ZONE 'Asia/Jakarta')::date - 1, 'YYYY-MM-DD') WHERE host_id = $1`, [host.id]);
  assert.equal(task(await list(host), 'checkin').state, 'claimable');
  assert.equal((await api('POST', '/api/tasks/checkin/claim', { token: host.token })).status, 200);
  assert.equal(await diamonds(host), 20);
  assert.equal((await api('POST', '/api/tasks/tidakada/claim', { token: host.token })).status, 404);
});

test('tugas pemula: momen berfoto lolos review dan 3 foto album lolos review', async () => {
  const host = await makeHost('hostpemula');
  assert.equal((await api('POST', '/api/tasks/moment/claim', { token: host.token })).status, 400, 'belum selesai');

  // momen berfoto masih menunggu -> belum; setelah disetujui -> bisa klaim
  const { rows: m } = await db.query(`INSERT INTO moments (host_id, body, image_url, status) VALUES ($1, 'a', 'http://x/m.jpg', 'pending') RETURNING id`, [host.id]);
  assert.equal(task(await list(host), 'moment').state, 'todo');
  await A('POST', `/api/admin/moments/${m[0].id}/approve`);
  assert.equal(task(await list(host), 'moment').state, 'claimable');
  assert.equal((await api('POST', '/api/tasks/moment/claim', { token: host.token })).status, 200);
  assert.equal(await diamonds(host), 100);
  assert.equal((await api('POST', '/api/tasks/moment/claim', { token: host.token })).status, 409, 'sekali seumur akun');

  // foto album: 2 disetujui belum cukup, 3 baru bisa
  for (let i = 1; i <= 3; i++) {
    const { rows } = await db.query(`INSERT INTO user_photos (user_id, url, status) VALUES ($1, $2, 'pending') RETURNING id`, [host.id, `http://x/${i}.jpg`]);
    await A('POST', `/api/admin/photos/${rows[0].id}/approve`);
    const t = task(await list(host), 'photos');
    assert.equal(t.progress, i);
    assert.equal(t.state, i < 3 ? 'todo' : 'claimable');
  }
  assert.equal((await api('POST', '/api/tasks/photos/claim', { token: host.token })).status, 200);
  assert.equal(await diamonds(host), 700);
});

test('tugas harian sukai: target diatur admin; hanya menyukai pengguna yang dihitung', async () => {
  assert.equal((await A('PATCH', '/api/admin/settings', { task_like_target: 2, task_reward_like: 7 })).status, 200);
  const host = await makeHost('hostsukaitugas');
  const users = [];
  for (const n of ['sukaisatu', 'sukaidua', 'sukaitiga']) {
    const u = await register(n);
    await db.query(`UPDATE users SET gender = 'male', profile_completed = true WHERE id = $1`, [u.id]);
    users.push(u);
  }
  assert.equal((await api('POST', '/api/tasks/like/claim', { token: host.token })).status, 400);
  await api('POST', `/api/users/${users[0].id}/like`, { token: host.token });
  let t = task(await list(host), 'like');
  assert.deepEqual([t.progress, t.target, t.state, t.reward], [1, 2, 'todo', 7]);
  await api('POST', `/api/users/${users[0].id}/like`, { token: host.token }); // pengguna sama: tidak dihitung dua kali
  assert.equal(task(await list(host), 'like').progress, 1);
  await api('POST', `/api/users/${users[1].id}/like`, { token: host.token });
  assert.equal(task(await list(host), 'like').state, 'claimable');
  assert.equal((await api('POST', '/api/tasks/like/claim', { token: host.token })).status, 200);
  assert.equal(await diamonds(host), 7);
  // admin tidak bisa mengisi nilai tidak masuk akal
  assert.equal((await A('PATCH', '/api/admin/settings', { task_like_target: 0 })).status, 400);
  assert.equal((await A('PATCH', '/api/admin/settings', { task_reward_photos: -5 })).status, 400);
});

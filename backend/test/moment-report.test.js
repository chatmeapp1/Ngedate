/**
 * Laporan momen dan komentar: bukti, duplikat, hapus oleh admin, hapus komentar.
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

const A = (method, p, body) => api(method, p, { token: admin, body });
async function makeHost(name) {
  const h = await register(name);
  await A('PATCH', `/api/admin/users/${h.id}/role`, { role: 'host' });
  await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true, gender = 'female' WHERE id = $1`, [h.id]);
  return h;
}
const postMoment = (token, text) => {
  const fd = new FormData();
  fd.append('body', text);
  return fetch(base + '/api/moments', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }));
};
const report = (token, body) => api('POST', '/api/reports', { token, body });

test('melaporkan momen: bukti tersalin, tidak ganda, harus milik terlapor, tidak untuk diri sendiri', async () => {
  const host = await makeHost('hostlapor');
  const other = await makeHost('hostlain');
  const user = await register('pelapor');
  const m = (await postMoment(host.token, 'Isi momen yang bermasalah')).body;

  assert.equal((await report(host.token, { targetId: host.id, reason: 'spam', momentId: m.id })).status, 400, 'tidak bisa melaporkan diri sendiri');
  assert.equal((await report(user.token, { targetId: other.id, reason: 'spam', momentId: m.id })).status, 400, 'momen bukan milik terlapor');
  assert.equal((await report(user.token, { targetId: host.id, reason: 'spam', momentId: 99999999 })).status, 404);
  assert.equal((await report(user.token, { targetId: host.id, reason: 'spam', momentId: m.id, conversationId: 1 })).status, 400, 'tidak digabung dengan laporan chat');

  const r1 = await report(user.token, { targetId: host.id, reason: 'sexual', momentId: m.id, details: 'foto tidak pantas' });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const r2 = await report(user.token, { targetId: host.id, reason: 'sexual', momentId: m.id });
  assert.equal(r2.body.duplicate, true, 'laporan momen yang sama tidak dibuat dua kali');

  const list = (await A('GET', '/api/admin/reports?status=pending')).body;
  const row = list.find((x) => x.momentId === m.id);
  assert.ok(row, 'laporan muncul di panel admin');
  assert.deepEqual([row.snapshot.kind, row.snapshot.body, row.commentId], ['moment', 'Isi momen yang bermasalah', null]);
  assert.equal(row.target.id, host.id);
  global.reported = { host, user, m, reportId: row.id };
});

test('melaporkan komentar: milik terlapor; admin menghapus komentar dan laporan selesai', async () => {
  const { host, user, m } = global.reported;
  const bad = await register('komentarburuk');
  assert.equal((await api('POST', `/api/moments/${m.id}/comments`, { token: bad.token, body: { body: 'komentar kasar sekali' } })).status, 201);
  const comments = (await api('GET', `/api/moments/${m.id}/comments`, { token: user.token })).body;
  const c = comments.find((x) => x.user.id === bad.id);

  assert.equal((await report(user.token, { targetId: host.id, reason: 'harassment', commentId: c.id })).status, 400, 'komentar bukan milik terlapor');
  assert.equal((await report(user.token, { targetId: bad.id, reason: 'harassment', commentId: c.id })).status, 201);
  const row = (await A('GET', '/api/admin/reports?status=pending')).body.find((x) => x.commentId === c.id);
  assert.deepEqual([row.snapshot.kind, row.snapshot.body], ['comment', 'komentar kasar sekali']);

  // hapus konten: komentar hilang, laporan selesai dengan aksi "remove"
  assert.equal((await A('POST', `/api/admin/reports/${row.id}/review`, { decision: 'remove', note: 'komentar kasar' })).status, 200);
  const after = (await api('GET', `/api/moments/${m.id}/comments`, { token: user.token })).body;
  assert.equal(after.some((x) => x.id === c.id), false);
  const done = (await A('GET', '/api/admin/reports?status=resolved')).body.find((x) => x.id === row.id);
  assert.equal(done.action, 'remove');
  assert.equal((await A('POST', `/api/admin/reports/${row.id}/review`, { decision: 'remove' })).status, 404, 'sudah ditinjau');
});

test('admin menghapus momen yang dilaporkan: momen hilang, host diberi tahu; laporan chat tidak bisa "remove"', async () => {
  const { host, user, m, reportId } = global.reported;
  assert.equal((await A('POST', `/api/admin/reports/${reportId}/review`, { decision: 'remove' })).status, 200);
  assert.equal((await api('GET', `/api/moments/${m.id}`, { token: user.token })).status, 404, 'momen sudah dihapus');
  const notes = (await api('GET', '/api/notifications', { token: host.token })).body;
  assert.ok(notes.some((n) => n.type === 'moment' && /dihapus admin/.test(n.title)));
  // laporan dari profil (tanpa momen/komentar) tidak punya konten untuk dihapus
  const prof = await report(user.token, { targetId: host.id, reason: 'spam' });
  assert.equal(prof.status, 201);
  const pl = (await A('GET', '/api/admin/reports?status=pending')).body;
  const pid = pl.find((x) => x.target.id === host.id && x.momentId === null && x.commentId === null).id;
  assert.equal((await A('POST', `/api/admin/reports/${pid}/review`, { decision: 'remove' })).status, 400);
});

test('hapus komentar: oleh penulisnya atau pemilik momen, bukan orang lain', async () => {
  const host = await makeHost('hostkomentar');
  const a = await register('penulisa');
  const b = await register('penulisb');
  const m = (await postMoment(host.token, 'momen untuk komentar')).body;
  const add = async (u, t) => (await api('POST', `/api/moments/${m.id}/comments`, { token: u.token, body: { body: t } })).body.id;
  const ca = await add(a, 'komentar a');
  const cb = await add(b, 'komentar b');
  assert.equal((await api('DELETE', `/api/moments/${m.id}/comments/${ca}`, { token: b.token })).status, 404, 'orang lain tidak bisa');
  assert.equal((await api('DELETE', `/api/moments/${m.id}/comments/${ca}`, { token: a.token })).status, 200, 'penulis sendiri');
  assert.equal((await api('DELETE', `/api/moments/${m.id}/comments/${cb}`, { token: host.token })).status, 200, 'pemilik momen');
  const left = (await api('GET', `/api/moments/${m.id}/comments`, { token: a.token })).body;
  assert.equal(left.length, 0);
});

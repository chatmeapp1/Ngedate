/**
 * Onboarding (lengkapi profil), kunci jenis kelamin, agency, verifikasi wajah, bagi hasil agency.
 * Database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amora-onb-'));
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const bcrypt = require('bcryptjs');

let server;
let base;
let admin;
let agency;

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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const form = (field = 'file', n = 1) => {
  const f = new FormData();
  for (let i = 0; i < n; i++) f.append(field, new Blob([PNG], { type: 'image/png' }), `f${i}.png`);
  return f;
};

async function quickUser() {
  const r = await api('POST', '/api/auth/quick', { body: { deviceKey: crypto.randomBytes(32).toString('base64url') } });
  return { id: r.body.user.id, token: r.body.accessToken, user: r.body.user };
}

async function withAvatar(u) {
  const r = await api('POST', '/api/me/avatar', { token: u.token, form: form() });
  assert.equal(r.status, 200);
  return u;
}

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.query(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]
  );
  admin = (await api('POST', '/api/auth/login', { body: { login: 'admin', password: 'admin123' } })).body.accessToken;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('admin membuat agency: kode otomatis, komisi tidak boleh melebihi sisa setelah bagian host (30%)', async () => {
  const bad = await api('POST', '/api/admin/agencies', { token: admin, body: { name: 'Rakus', commissionRate: 0.8 } });
  assert.equal(bad.status, 400);
  const r = await api('POST', '/api/admin/agencies', { token: admin, body: { name: 'Bintang Agency', commissionRate: 0.1 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.code, /^[0-9A-F]{6}$/);
  agency = r.body;
  const custom = await api('POST', '/api/admin/agencies', { token: admin, body: { name: 'Lain', code: 'lain01' } });
  assert.equal(custom.body.code, 'LAIN01');
  const dup = await api('POST', '/api/admin/agencies', { token: admin, body: { name: 'Dup', code: 'LAIN01' } });
  assert.equal(dup.body.error.code, 'CODE_TAKEN');
});

test('akun baru belum lengkap; wajib foto dulu', async () => {
  const u = await quickUser();
  assert.equal(u.user.profileCompleted, false);
  const r = await api('POST', '/api/onboarding/complete', {
    token: u.token,
    body: { gender: 'male', displayName: 'Budi', birthDate: '1995-01-01' },
  });
  assert.equal(r.body.error.code, 'AVATAR_REQUIRED');
});

test('pria: jadi user, jenis kelamin terkunci, tidak bisa lengkapi dua kali', async () => {
  const u = await withAvatar(await quickUser());
  const minor = await api('POST', '/api/onboarding/complete', {
    token: u.token,
    body: { gender: 'male', displayName: 'Budi', birthDate: '2015-01-01' },
  });
  assert.equal(minor.body.error.code, 'UNDERAGE');

  const r = await api('POST', '/api/onboarding/complete', {
    token: u.token,
    body: { gender: 'male', displayName: 'Budi', birthDate: '1995-01-01' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.profileCompleted, true);
  assert.equal(r.body.role, 'user');
  assert.equal(r.body.gender, 'male');
  assert.ok(r.body.avatarUrl, 'foto user biasa langsung aktif');

  const lock = await api('PATCH', '/api/me', { token: u.token, body: { gender: 'female' } });
  assert.equal(lock.status, 409);
  assert.equal(lock.body.error.code, 'GENDER_LOCKED');

  const again = await api('POST', '/api/onboarding/complete', {
    token: u.token,
    body: { gender: 'female', displayName: 'Xena', birthDate: '1995-01-01', inviteCode: agency.code },
  });
  assert.equal(again.body.error.code, 'ALREADY_COMPLETED');

  const tags = await api('PATCH', '/api/me', { token: u.token, body: { tags: ['Musik', 'kopi', 'musik'], language: 'en' } });
  assert.deepEqual(tags.body.tags, ['musik', 'kopi']);
  assert.equal(tags.body.language, 'en');
});

let host;

test('wanita: wajib kode agency, jadi host "pending" dan belum tampil', async () => {
  const u = await withAvatar(await quickUser());
  const noCode = await api('POST', '/api/onboarding/complete', {
    token: u.token,
    body: { gender: 'female', displayName: 'Sari', birthDate: '1998-02-02' },
  });
  assert.equal(noCode.body.error.code, 'INVALID_INVITE');
  assert.equal((await api('GET', '/api/onboarding/agency/SALAH9', { token: u.token })).status, 404);
  const check = await api('GET', `/api/onboarding/agency/${agency.code.toLowerCase()}`, { token: u.token });
  assert.equal(check.body.name, 'Bintang Agency');

  const r = await api('POST', '/api/onboarding/complete', {
    token: u.token,
    body: { gender: 'female', displayName: 'Sari', birthDate: '1998-02-02', inviteCode: agency.code },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.role, 'host');
  assert.equal(r.body.hostStatus, 'pending');
  assert.equal(r.body.verified, false);
  assert.equal(r.body.agencyName, 'Bintang Agency');
  assert.equal(r.body.verificationStatus, 'none');
  host = u;

  const list = await api('GET', '/api/hosts', { token: u.token });
  assert.ok(!list.body.some((h) => h.id === u.id), 'host pending tidak tampil');
  const buyer = await withAvatar(await quickUser());
  const conv = await api('POST', '/api/conversations', { token: buyer.token, body: { hostId: u.id } });
  assert.equal(conv.status, 404, 'belum bisa dichat');
});

test('verifikasi wajah: 3 gerakan acak, sekali pakai, ada batas waktu', async () => {
  const user = await quickUser();
  assert.equal((await api('POST', '/api/onboarding/verification/challenge', { token: user.token })).status, 403);

  const ch = await api('POST', '/api/onboarding/verification/challenge', { token: host.token });
  assert.equal(ch.status, 201);
  assert.equal(ch.body.steps.length, 3);
  assert.equal(new Set(ch.body.steps.map((s) => s.key)).size, 3);
  assert.ok(ch.body.steps.every((s) => s.text.length > 5));

  const two = new FormData();
  two.append('challengeId', String(ch.body.challengeId));
  for (let i = 0; i < 2; i++) two.append('photos', new Blob([PNG], { type: 'image/png' }), `p${i}.png`);
  const r2 = await api('POST', '/api/onboarding/verification', { token: host.token, form: two });
  assert.equal(r2.body.error.code, 'PHOTOS_REQUIRED');

  // Tantangan kedaluwarsa
  await db.query(`UPDATE verification_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, [ch.body.challengeId]);
  const f = form('photos', 3);
  f.append('challengeId', String(ch.body.challengeId));
  assert.equal((await api('POST', '/api/onboarding/verification', { token: host.token, form: f })).body.error.code, 'CHALLENGE_EXPIRED');

  // Tantangan baru, kirim 3 foto
  const ch2 = await api('POST', '/api/onboarding/verification/challenge', { token: host.token });
  const ok = form('photos', 3);
  ok.append('challengeId', String(ch2.body.challengeId));
  const sent = await api('POST', '/api/onboarding/verification', { token: host.token, form: ok });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.status, 'pending');

  // Tidak bisa dipakai ulang & tidak bisa minta tantangan saat masih ditinjau
  const reuse = form('photos', 3);
  reuse.append('challengeId', String(ch2.body.challengeId));
  assert.equal((await api('POST', '/api/onboarding/verification', { token: host.token, form: reuse })).status, 409);
  assert.equal((await api('POST', '/api/onboarding/verification/challenge', { token: host.token })).body.error.code, 'VERIFICATION_PENDING');
});

test('admin menolak lalu menyetujui verifikasi: host dapat centang biru & tampil', async () => {
  let list = await api('GET', '/api/admin/verifications', { token: admin });
  assert.equal(list.body.length, 1);
  const v1 = list.body[0];
  assert.equal(v1.photoUrls.length, 3);
  assert.equal(v1.steps.length, 3);
  assert.equal(v1.agencyName, 'Bintang Agency');
  assert.ok(v1.avatarUrl, 'admin bisa membandingkan dengan foto profil');

  await api('POST', `/api/admin/verifications/${v1.id}/reject`, { token: admin, body: { reason: 'Gerakan tidak sesuai' } });
  const st = await api('GET', '/api/onboarding/verification', { token: host.token });
  assert.equal(st.body.status, 'rejected');
  assert.equal(st.body.rejectReason, 'Gerakan tidak sesuai');

  // Ulangi
  const ch = await api('POST', '/api/onboarding/verification/challenge', { token: host.token });
  const f = form('photos', 3);
  f.append('challengeId', String(ch.body.challengeId));
  await api('POST', '/api/onboarding/verification', { token: host.token, form: f });
  list = await api('GET', '/api/admin/verifications', { token: admin });
  assert.equal((await api('POST', `/api/admin/verifications/${list.body[0].id}/approve`, { token: admin })).status, 200);

  const me = await api('GET', '/api/me', { token: host.token });
  assert.equal(me.body.verified, true);
  assert.equal(me.body.hostStatus, 'approved');
  assert.equal(me.body.verificationStatus, 'approved');

  const hosts = await api('GET', '/api/hosts', { token: host.token });
  const h = hosts.body.find((x) => x.id === host.id);
  assert.ok(h, 'host tampil setelah disetujui');
  assert.equal(h.verified, true);
});

test('bagi hasil: host 30% bersih, agency 10% dari bagian app, platform 60%', async () => {
  await db.query(`UPDATE host_profiles SET chat_price = 100 WHERE user_id = $1`, [host.id]);
  const buyer = await withAvatar(await quickUser());
  await api('POST', `/api/admin/users/${buyer.id}/coins`, { token: admin, body: { amount: 5000 } });
  const conv = await api('POST', '/api/conversations', { token: buyer.token, body: { hostId: host.id } });
  assert.equal(conv.status, 200, JSON.stringify(conv.body));

  await api('POST', `/api/conversations/${conv.body.id}/messages`, { token: buyer.token, body: { body: 'halo' } });
  const reply = await api('POST', `/api/conversations/${conv.body.id}/messages`, { token: host.token, body: { body: 'hai' } });
  assert.equal(reply.body.settled.hostIncome, 30);

  const { rows: g } = await db.query(`INSERT INTO gifts (name, price) VALUES ('Mawar', 1000) RETURNING id`);
  const gift = await api('POST', `/api/conversations/${conv.body.id}/gifts`, { token: buyer.token, body: { giftId: g[0].id } });
  assert.equal(gift.status, 201);

  const { rows: u } = await db.query(`SELECT diamonds FROM users WHERE id = $1`, [host.id]);
  assert.equal(Number(u[0].diamonds), 30 + 300);
  const { rows: a } = await db.query(`SELECT earnings_total FROM agencies WHERE id = $1`, [agency.id]);
  assert.equal(Number(a[0].earnings_total), 10 + 100, 'agency 10% dari total, bukan dari bagian host');
  const { rows: p } = await db.query(`SELECT SUM(amount)::int AS s FROM platform_earnings`);
  assert.equal(p[0].s, 60 + 600);

  // Agency nonaktif: host tetap 30%, sisanya ke platform (komisi tidak pindah ke host)
  await api('PATCH', `/api/admin/agencies/${agency.id}`, { token: admin, body: { active: false } });
  await api('POST', `/api/conversations/${conv.body.id}/gifts`, { token: buyer.token, body: { giftId: g[0].id } });
  const { rows: u2 } = await db.query(`SELECT diamonds FROM users WHERE id = $1`, [host.id]);
  assert.equal(Number(u2[0].diamonds), 330 + 300);
});

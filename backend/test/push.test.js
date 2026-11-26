/**
 * Token push, pengirim notifikasi (tanpa kunci FCM = diam), unggah suara gift.
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
delete process.env.FCM_SERVICE_ACCOUNT;
delete process.env.FCM_SERVICE_ACCOUNT_JSON;

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');
const push = require('../src/services/push');

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

test('token push: simpan, pindah ke akun lain, hapus; harus login', async () => {
  const tok = 'fcm-token-' + 'x'.repeat(40);
  const a = await register('akun1');
  const b = await register('akun2');
  assert.equal((await api('POST', '/api/me/push-token', { body: { token: tok } })).status, 401);
  assert.equal((await api('POST', '/api/me/push-token', { token: a.token, body: { token: 'pendek' } })).status, 400);
  assert.equal((await api('POST', '/api/me/push-token', { token: a.token, body: { token: tok } })).status, 200);
  assert.equal((await db.query(`SELECT user_id FROM push_tokens WHERE token = $1`, [tok])).rows[0].user_id, String(a.id));
  // HP yang sama dipakai akun lain: token pindah
  await api('POST', '/api/me/push-token', { token: b.token, body: { token: tok } });
  assert.equal((await db.query(`SELECT user_id FROM push_tokens WHERE token = $1`, [tok])).rows[0].user_id, String(b.id));
  // akun lama tidak bisa menghapus token milik akun lain
  await api('DELETE', `/api/me/push-token?token=${tok}`, { token: a.token });
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM push_tokens`)).rows[0].n, 1);
  await api('DELETE', `/api/me/push-token?token=${tok}`, { token: b.token });
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM push_tokens`)).rows[0].n, 0);
});

test('tanpa kunci FCM, pengirim notifikasi diam dan pesan tetap terkirim', async () => {
  assert.equal(push.enabled(), false);
  await push.notify(1, { title: 'x', body: 'y' }); // tidak melempar error

  const host = await register('hostpush');
  await api('PATCH', `/api/admin/users/${host.id}/role`, { token: admin, body: { role: 'host' } });
  const user = await register('userpush');
  await api('POST', '/api/me/push-token', { token: host.token, body: { token: 'host-token-' + 'y'.repeat(40) } });
  await api('POST', `/api/admin/users/${user.id}/coins`, { token: admin, body: { amount: 1000 } });
  const conv = (await api('POST', '/api/conversations', { token: user.token, body: { hostId: host.id } })).body;
  const r = await api('POST', `/api/conversations/${conv.id}/messages`, { token: user.token, body: { body: 'halo' } });
  assert.equal(r.status, 201);
});

test('unggah suara gift: hanya admin, isi file diperiksa, tersimpan di gift', async () => {
  const send = async (token, bytes, type) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), 's.mp3');
    const res = await fetch(`${base}/api/admin/upload-audio`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);
  const u = await register('bukanadmin');
  assert.equal((await send(u.token, mp3, 'audio/mpeg')).status, 403);
  const ok = await send(admin, mp3, 'audio/mpeg');
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.match(ok.body.url, /\/uploads\/.+\.mp3$/);
  assert.equal((await send(admin, Buffer.from('bukan audio sama sekali'), 'audio/mpeg')).status, 400);
  assert.equal((await send(admin, mp3, 'image/png')).status, 400);

  const g = await api('POST', '/api/admin/gifts', { token: admin, body: { name: 'Bersuara', price: 100, soundUrl: ok.body.url } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const list = (await api('GET', '/api/gifts', { token: u.token })).body;
  assert.equal(list.find((x) => x.name === 'Bersuara').soundUrl, ok.body.url);
});

test('pengiriman FCM (server tiruan): token OAuth, isi pesan, hanya jika offline, token mati dibersihkan', async () => {
  const crypto = require('crypto');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sent = [];
  let tokenCalls = 0;
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/token') {
        tokenCalls++;
        const jwt = new URLSearchParams(raw).get('assertion');
        assert.equal(jwt.split('.').length, 3);
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }));
      }
      const body = JSON.parse(raw);
      sent.push({ url: req.url, auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (body.message.token.startsWith('mati-')) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } }));
      }
      res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  process.env.FCM_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.FCM_TOKEN_URL = `http://127.0.0.1:${port}/token`;
  process.env.FCM_RELOAD = '1';
  process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'x@proj.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    project_id: 'proj-test',
  });
  try {
    assert.equal(push.enabled(), true);
    const u = await register('penerima');
    await db.query(`INSERT INTO push_tokens (token, user_id) VALUES ($1, $2), ($3, $2)`, ['hidup-' + 'a'.repeat(30), u.id, 'mati-' + 'b'.repeat(30)]);

    await push.notify(u.id, { title: 'Sari', body: 'Halo kamu', data: { type: 'chat', conversationId: 7 } });
    assert.equal(sent.length, 2, 'dua perangkat');
    assert.equal(sent[0].url, '/v1/projects/proj-test/messages:send');
    assert.equal(sent[0].auth, 'Bearer tok-abc');
    const m = sent.find((x) => x.body.message.token.startsWith('hidup-')).body.message;
    assert.equal(m.notification.title, 'Sari');
    assert.equal(m.data.conversationId, '7', 'data berupa string');
    assert.equal(m.android.notification.channel_id, 'messages');
    assert.equal(tokenCalls, 1);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM push_tokens WHERE user_id = $1`, [u.id])).rows[0].n, 1, 'token mati dihapus');

    await push.notify(u.id, { title: 'b', body: 'c' });
    assert.equal(tokenCalls, 1, 'token OAuth dipakai ulang (cache)');
  } finally {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    delete process.env.FCM_BASE_URL;
    delete process.env.FCM_TOKEN_URL;
    process.env.FCM_RELOAD = '1';
    push.enabled();
    delete process.env.FCM_RELOAD;
    fake.close();
  }
});

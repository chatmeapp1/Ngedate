/**
 * Gaji pokok host: program admin, waktu online, target pendapatan, bayar otomatis.
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
const salary = require('../src/services/salary');
const wallet = require('../src/services/wallet');

const weekStart = async () => (await db.query(`SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')::date::text AS d`)).rows[0].d;
const setOnline = (u, offset, seconds) =>
  db.query(
    `INSERT INTO host_online_daily (host_id, day, seconds) VALUES ($1, ($2::date + $3::int), $4)
     ON CONFLICT (host_id, day) DO UPDATE SET seconds = EXCLUDED.seconds`,
    [u.id, weekStart_, offset, seconds]
  );
let weekStart_;
const earn = (u, amount, reason = 'gift_income') =>
  db.tx((c) => wallet.creditDiamonds(c, u.id, amount, reason, { type: 'test', id: 1 }));
const mySalary = async (u) => (await api('GET', '/api/salary', { token: u.token })).body;

test('hanya host; belum ikut program = enrolled false; admin menambah host (peringatan risiko)', async () => {
  weekStart_ = await weekStart();
  const user = await register('penggunagaji');
  assert.equal((await api('GET', '/api/salary', { token: user.token })).status, 403);
  const host = await makeHost('hostgaji');
  assert.deepEqual(await mySalary(host), { enrolled: false });

  // bukan host / tidak ada
  assert.equal((await A('POST', '/api/admin/salary', { hostId: user.id })).status, 404);
  assert.equal((await A('POST', '/api/admin/salary', { hostId: 99999999 })).status, 404);
  assert.equal((await A('POST', '/api/admin/salary', { hostId: host.id, daysRequired: 9 })).status, 400);

  // gaji sangat besar dibanding target: berisiko rugi, perlu konfirmasi
  const big = await A('POST', '/api/admin/salary', { hostId: host.id, reward: 150000, incomeTarget: 70000 });
  assert.equal(big.status, 400);
  assert.equal(big.body.error.code, 'LOSS_RISK');
  const forced = await A('POST', '/api/admin/salary', { hostId: host.id, reward: 150000, incomeTarget: 70000, force: true });
  assert.equal(forced.status, 201);
  assert.equal((await A('POST', '/api/admin/salary', { hostId: host.id })).status, 400, 'tidak bisa didaftarkan dua kali');
  // perkiraan risiko terbuka untuk panel
  const rk = (await A('GET', '/api/admin/salary/risk?reward=150000&target=70000')).body;
  assert.equal(rk.risky, true);
  assert.ok(rk.chatOnly.lossRp > 0 && rk.giftOnly.lossRp < 0, 'lewat gift tetap untung');

  // atur ulang ke angka wajar (tanpa risiko) dan lihat status awal
  const ok = await A('PATCH', `/api/admin/salary/${host.id}`, { reward: 20000, incomeTarget: 70000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const st = await mySalary(host);
  assert.ok(st.dayEndsIn > 0 && st.dayEndsIn <= 86400, 'sisa detik sampai 00:00 WIB');
  assert.ok(st.weekEndsIn >= st.dayEndsIn);
  assert.deepEqual(
    [st.enrolled, st.minutesPerDay, st.daysRequired, st.incomeTarget, st.reward, st.todayMinutes, st.validDays, st.income, st.paid],
    [true, 120, 5, 70000, 20000, 0, 0, 0, false]
  );
  assert.ok((await db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'salary'`, [host.id])).rows.length >= 1);
});

test('waktu online hanya dicatat untuk host program; hari valid = 120 menit penuh', async () => {
  const a = await makeHost('hostonlinea');
  const b = await makeHost('hostonlineb');
  await A('POST', '/api/admin/salary', { hostId: a.id, reward: 20000, incomeTarget: 70000 });
  const n = await salary.tick(30, [a.id, b.id]);
  assert.equal(n, 1, 'hanya host program yang dicatat');
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM host_online_daily WHERE host_id = $1`, [b.id])).rows[0].n, 0);
  await salary.tick(30, [a.id]);
  assert.equal(Number((await db.query(`SELECT seconds FROM host_online_daily WHERE host_id = $1`, [a.id])).rows[0].seconds), 60);

  await setOnline(a, 0, 7199); // kurang 1 detik: belum valid
  await setOnline(a, 1, 7200); // pas 120 menit: valid
  const st = await mySalary(a);
  assert.equal(st.validDays, 1);
});

test('bayar otomatis sekali per minggu setelah 5 hari valid + target pendapatan chat/gift', async () => {
  const host = await makeHost('hostbayar');
  await A('POST', '/api/admin/salary', { hostId: host.id, reward: 20000, incomeTarget: 70000 });
  const evalPaid = () => salary.evaluate(host.id);

  for (let i = 0; i < 4; i++) await setOnline(host, i, 7200);
  await earn(host, 70000);
  assert.equal(await evalPaid(), 0, 'baru 4 hari valid');

  await setOnline(host, 4, 7200);
  assert.equal((await mySalary(host)).paid, true, 'GET status juga membayar otomatis bila syarat terpenuhi');
  assert.equal(await diamonds(host), 70000 + 20000);
  assert.equal(await evalPaid(), 0, 'tidak dibayar dua kali dalam minggu yang sama');
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM host_salary_payouts WHERE host_id = $1`, [host.id])).rows[0].n, 1);
  assert.ok((await db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title ILIKE 'Gaji pokok diterima'`, [host.id])).rows.length === 1);
  assert.equal(await salary.sweep() >= 0, true);
});

test('target pendapatan belum tercapai = belum dibayar; gift saja tanpa hari valid tidak cukup; uang gaji tidak dihitung sebagai pendapatan', async () => {
  const host = await makeHost('hosttarget');
  await A('POST', '/api/admin/salary', { hostId: host.id, reward: 20000, incomeTarget: 70000 });
  for (let i = 0; i < 5; i++) await setOnline(host, i, 9000);
  await earn(host, 69999);
  assert.equal(await salary.evaluate(host.id), 0, 'target kurang 1');
  // pendapatan dari kartu gratis (dibayar app) tidak dihitung
  await earn(host, 500, 'free_card_income');
  assert.equal(await salary.evaluate(host.id), 0);
  await earn(host, 1, 'chat_income');
  assert.equal(await salary.evaluate(host.id), 20000);

  const other = await makeHost('hostgiftsaja');
  await A('POST', '/api/admin/salary', { hostId: other.id, reward: 20000, incomeTarget: 70000 });
  await earn(other, 100000);
  assert.equal(await salary.evaluate(other.id), 0, 'tanpa hari online valid belum dibayar');
});

test('admin menghapus host dari program; daftar admin menampilkan progres', async () => {
  const host = await makeHost('hostkeluar');
  await A('POST', '/api/admin/salary', { hostId: host.id, reward: 20000, incomeTarget: 70000 });
  const list = (await A('GET', '/api/admin/salary')).body;
  const row = list.find((r) => r.hostId === host.id);
  assert.ok(row && row.active && row.reward === 20000);
  assert.equal((await A('DELETE', `/api/admin/salary/${host.id}`)).status, 200);
  assert.deepEqual(await mySalary(host), { enrolled: false });
  assert.equal((await A('DELETE', `/api/admin/salary/${host.id}`)).status, 404);
  assert.equal(await salary.evaluate(host.id), 0);
  assert.equal((await api('POST', '/api/admin/salary', { token: host.token, body: { hostId: host.id } })).status, 403);
  // bisa didaftarkan lagi
  assert.equal((await A('POST', '/api/admin/salary', { hostId: host.id, reward: 20000, incomeTarget: 70000 })).status, 201);
});

test('penghasilan sebelum didaftarkan tidak dihitung; penarikan sesudahnya tidak mengurangi progres', async () => {
  const host = await makeHost('hostwd');
  // 70.000 diamond didapat SEBELUM didaftarkan ke gaji pokok
  await earn(host, 70000);
  await A('POST', '/api/admin/salary', { hostId: host.id, reward: 20000, incomeTarget: 70000 });
  assert.equal((await mySalary(host)).income, 0, 'penghasilan sebelum didaftarkan tidak dihitung');

  // setelah didaftarkan: dapat 70.000 -> progres penuh
  await earn(host, 70000);
  assert.equal((await mySalary(host)).income, 70000);

  // lalu ditarik 100.000: progres yang sudah selesai TIDAK berkurang
  await db.tx(async (c) => {
    await wallet.debitDiamonds(c, host.id, 100000, 'withdraw_hold', { type: 'test', id: 1 });
    await c.query(
      `INSERT INTO withdrawals (user_id, diamonds, currency, diamonds_per_usd, usd_idr, gross, fee, net, kind, provider, account_number, status)
       VALUES ($1, 100000, 'IDR', 6667, 17000, 255000, 0, 255000, 'bank', 'BCA', '123', 'paid')`,
      [host.id]
    );
  });
  assert.equal((await mySalary(host)).income, 70000, 'penarikan tidak mengurangi progres');

  // keluar lalu didaftarkan lagi: penghasilan lama tidak ikut
  await A('DELETE', `/api/admin/salary/${host.id}`);
  await A('POST', '/api/admin/salary', { hostId: host.id, reward: 20000, incomeTarget: 70000 });
  assert.equal((await mySalary(host)).income, 0);
});

test('target tercapai lalu langsung ditarik: gaji tetap dibayar setelah hari valid terpenuhi', async () => {
  const host = await makeHost('hostwdbayar');
  await A('POST', '/api/admin/salary', { hostId: host.id, reward: 20000, incomeTarget: 70000 });
  for (let i = 0; i < 5; i++) await setOnline(host, i, 7200);
  await earn(host, 70000);
  // semua diamond ditarik sebelum diperiksa
  await db.tx((c) => wallet.debitDiamonds(c, host.id, 70000, 'withdraw_hold', { type: 'test', id: 2 }));
  assert.equal(await diamonds(host), 0);
  assert.equal(await salary.evaluate(host.id), 20000, 'target yang sudah tercapai tidak hilang karena ditarik');
  assert.equal(await diamonds(host), 20000);
});

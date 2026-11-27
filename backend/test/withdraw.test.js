/**
 * Penarikan diamond host: Indonesia -> bank/e-wallet (Rupiah), negara lain -> USDT TRC20 (USD).
 * Kurs awal: 6.667 diamond = 1 USD (1 diamond = Rp 2,55), 1 USD = Rp 17.000, minimal 70.000 diamond, biaya jaringan USDT US$ 1.
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
const { isTronAddress } = require('../src/lib/tron');

let server;
let base;
let admin, sari, maria, budi, tanpaPass, tanpaRek;

async function api(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function register(username) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: 'rahasia123', displayName: username } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: Number(r.body.user.id), token: r.body.accessToken };
}

async function makeHost(username, country, diamonds) {
  const h = await register(username);
  await db.query(
    `UPDATE users SET role = 'host', host_status = 'approved', gender = 'female', profile_completed = true, country_code = $2, diamonds = $3 WHERE id = $1`,
    [h.id, country, diamonds]
  );
  return h;
}

const diamonds = async (id) => Number((await db.query(`SELECT diamonds FROM users WHERE id = $1`, [id])).rows[0].diamonds);
const idr = (d) => Math.floor((d * 17000) / 6667);
const usdCents = (d) => Math.floor((d * 100) / 6667);
const BANK = { provider: 'BCA', accountNumber: '1234 5678 90', accountName: 'Sari Dewi', password: 'rahasia123' };
// Alamat kontrak USDT TRC20: bentuk & checksum valid, dipakai sebagai contoh alamat dompet
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT = { provider: 'USDT (TRC20)', accountNumber: TRON, password: 'rahasia123' };

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

  sari = await makeHost('sari', 'ID', 1000000);
  tanpaRek = await makeHost('tanparek', 'ID', 500000);
  maria = await makeHost('maria', 'CO', 1000000);
  budi = await register('budi');
  // host dari Login cepat: belum pernah mengatur password
  const q = await api('POST', '/api/auth/quick', { body: { deviceKey: 'q'.repeat(40) } });
  tanpaPass = { id: Number(q.body.user.id), token: q.body.accessToken };
  await db.query(`UPDATE users SET role = 'host', host_status = 'approved', country_code = 'ID', diamonds = 500000 WHERE id = $1`, [tanpaPass.id]);
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

test('validator alamat Tron: checksum, awalan, panjang, jaringan lain', () => {
  assert.equal(isTronAddress(TRON), true);
  assert.equal(isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'), false, 'satu huruf salah');
  assert.equal(isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6'), false, 'terlalu pendek');
  assert.equal(isTronAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'), false, 'alamat Bitcoin');
  assert.equal(isTronAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e'), false, 'alamat Ethereum/BSC');
  assert.equal(isTronAddress(''), false);
  assert.equal(isTronAddress(null), false);
});

test('info penarikan: hanya host; metode mengikuti negara; kurs & minimal dari pengaturan', async () => {
  assert.equal((await api('GET', '/api/withdrawals/options', { token: budi.token })).status, 403);
  assert.equal((await api('GET', '/api/withdrawals/options')).status, 401);

  const id = (await api('GET', '/api/withdrawals/options', { token: sari.token })).body;
  assert.equal(id.method, 'idr');
  assert.equal(id.currency, 'IDR');
  assert.equal(id.diamonds, 1000000);
  assert.equal(id.diamondsPerUsd, 6667);
  assert.equal(id.usdIdr, 17000);
  assert.equal(id.minDiamonds, 70000);
  assert.equal(id.feePercent, 0);
  assert.equal(id.usdtFeeUsd, 1);
  assert.equal(id.passwordSet, true);
  assert.equal(id.account, null);
  assert.equal(id.pending, null);
  assert.ok(id.providers.some((p) => p.name === 'BCA' && p.kind === 'bank'));
  assert.ok(id.providers.some((p) => p.name === 'GoPay' && p.kind === 'ewallet'));
  assert.ok(!id.providers.some((p) => p.kind === 'crypto'));

  const co = (await api('GET', '/api/withdrawals/options', { token: maria.token })).body;
  assert.equal(co.method, 'usdt');
  assert.equal(co.currency, 'USD');
  assert.deepEqual(co.providers, [{ kind: 'crypto', name: 'USDT (TRC20)' }]);
});

test('akun tanpa password (Login cepat) wajib mengatur password dulu', async () => {
  const acc = await api('PUT', '/api/withdrawals/account', { token: tanpaPass.token, body: BANK });
  assert.equal(acc.status, 403);
  assert.equal(acc.body.error.code, 'PASSWORD_REQUIRED');
  const req = await api('POST', '/api/withdrawals', { token: tanpaPass.token, body: { diamonds: 70000 } });
  assert.equal(req.status, 403);
  assert.equal(req.body.error.code, 'PASSWORD_REQUIRED');
  assert.equal(await diamonds(tanpaPass.id), 500000);
});

test('host Indonesia: rekening bank divalidasi, wajib password, nomor disamarkan, tidak boleh USDT', async () => {
  const put = (body) => api('PUT', '/api/withdrawals/account', { token: sari.token, body: { ...BANK, ...body } });
  assert.equal((await put({ password: 'salahsalah' })).status, 401);
  assert.equal((await put({ password: undefined })).status, 400);
  assert.equal((await put({ provider: 'Bank Abal-abal' })).status, 400);
  assert.equal((await put({ accountNumber: '12ab34' })).status, 400);
  assert.equal((await put({ accountNumber: '123' })).status, 400);
  assert.equal((await put({ accountName: 'X' })).status, 400);
  assert.equal((await put({ accountName: 'Sari <script>' })).status, 400);
  assert.equal((await put({ provider: 'USDT (TRC20)', accountNumber: TRON })).status, 400, 'host Indonesia memakai bank/e-wallet');

  const ok = await put({});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.cooldownUntil, null, 'rekening pertama tidak kena jeda');
  const o = (await api('GET', '/api/withdrawals/options', { token: sari.token })).body;
  assert.equal(o.account.provider, 'BCA');
  assert.equal(o.account.kind, 'bank');
  assert.equal(o.account.accountNumber, '••••••7890', 'hanya 4 digit terakhir terlihat');
  assert.equal((await put({})).body.cooldownUntil, null, 'data sama tidak memicu jeda');
});

test('host luar negeri: alamat USDT TRC20 divalidasi ketat', async () => {
  const put = (body) => api('PUT', '/api/withdrawals/account', { token: maria.token, body: { ...USDT, ...body } });
  assert.equal((await put({ password: 'salahsalah' })).status, 401);
  const typo = await put({ accountNumber: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u' });
  assert.equal(typo.status, 400);
  assert.equal(typo.body.error.code, 'INVALID_ADDRESS');
  assert.equal((await put({ accountNumber: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' })).status, 400, 'bukan alamat Tron');
  assert.equal((await put({ accountNumber: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' })).status, 400, 'jaringan lain ditolak');
  assert.equal((await put({ accountNumber: 'abc' })).status, 400);
  assert.equal((await put({ provider: 'BCA', accountNumber: '1234567890', accountName: 'Maria Lopez' })).status, 400, 'bank Indonesia tidak untuk host luar negeri');

  const ok = await put({});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const o = (await api('GET', '/api/withdrawals/options', { token: maria.token })).body;
  assert.equal(o.account.kind, 'crypto');
  assert.equal(o.account.provider, 'USDT (TRC20)');
  assert.equal(o.account.accountNumber, 'TR7N…Lj6t', 'alamat hanya tampil awal & akhir');
  assert.equal(o.account.accountName, null);
});

test('pengajuan Rupiah: validasi, hitungan dari kurs USD, diamond ditahan, hanya satu yang berjalan', async () => {
  const req = (d, token = sari.token) => api('POST', '/api/withdrawals', { token, body: { diamonds: d } });
  assert.equal((await req(50000)).body.error.code, 'BELOW_MINIMUM');
  assert.equal((await req(0)).status, 400);
  assert.equal((await req(2000000)).body.error.code, 'INSUFFICIENT_DIAMONDS');
  assert.equal((await req(70000, tanpaRek.token)).body.error.code, 'NO_PAYOUT_ACCOUNT');
  assert.equal(await diamonds(sari.id), 1000000, 'penolakan tidak memotong diamond');

  const ok = await req(100000);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'pending');
  assert.equal(ok.body.currency, 'IDR');
  assert.equal(ok.body.diamonds, 100000);
  assert.equal(ok.body.gross, idr(100000));
  assert.equal(ok.body.gross, 254987, '100.000 diamond / 6.667 x Rp 17.000');
  assert.equal(ok.body.fee, 0);
  assert.equal(ok.body.net, 254987);
  assert.equal(ok.body.diamondsPerUsd, 6667);
  assert.equal(ok.body.accountNumber, '••••••7890');
  assert.equal(await diamonds(sari.id), 900000, 'diamond ditahan');
  const led = (await db.query(`SELECT amount, balance_after FROM ledger WHERE user_id = $1 AND reason = 'withdraw_hold'`, [sari.id])).rows;
  assert.deepEqual(led.map((r) => [Number(r.amount), Number(r.balance_after)]), [[-100000, 900000]]);

  const second = await req(70000);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'PENDING_EXISTS');
  assert.equal(await diamonds(sari.id), 900000);
  assert.equal((await api('GET', '/api/withdrawals/options', { token: sari.token })).body.pending.id, ok.body.id);
});

test('pengajuan USDT: jumlah dalam sen USD, dikurangi biaya jaringan; minimal 70.000 diamond', async () => {
  const req = (d) => api('POST', '/api/withdrawals', { token: maria.token, body: { diamonds: d } });
  assert.equal((await req(69999)).body.error.code, 'BELOW_MINIMUM');
  const ok = await req(70000);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.currency, 'USD');
  assert.equal(ok.body.gross, usdCents(70000));
  assert.equal(ok.body.gross, 1049, '70.000 diamond = US$ 10,49');
  assert.equal(ok.body.fee, 100, 'biaya jaringan USDT US$ 1');
  assert.equal(ok.body.net, 949);
  assert.equal(ok.body.provider, 'USDT (TRC20)');
  assert.equal(await diamonds(maria.id), 930000);
  assert.equal((await req(70000)).status, 409);
});

test('batal mengembalikan diamond; biaya % dan biaya jaringan dihitung dari pengaturan admin', async () => {
  const mine = (await api('GET', '/api/withdrawals', { token: sari.token })).body;
  const cancel = await api('POST', `/api/withdrawals/${mine[0].id}/cancel`, { token: sari.token });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, 'cancelled');
  assert.equal(await diamonds(sari.id), 1000000);
  assert.equal((await api('POST', `/api/withdrawals/${mine[0].id}/cancel`, { token: sari.token })).status, 409);
  assert.equal((await api('POST', `/api/withdrawals/${mine[0].id}/cancel`, { token: tanpaRek.token })).status, 404, 'milik host lain');

  // validasi pengaturan oleh admin
  const set = (b) => api('PATCH', '/api/admin/settings', { token: admin.token, body: b });
  assert.equal((await set({ withdraw_diamonds_per_usd: 0 })).status, 400);
  assert.equal((await set({ withdraw_usd_idr: 10 })).status, 400);
  assert.equal((await set({ withdraw_fee_percent: 60 })).status, 400);
  assert.equal((await set({ withdraw_min_diamonds: 0 })).status, 400);
  assert.equal((await set({ withdraw_usdt_fee_usd: 100 })).status, 400);
  assert.equal((await set({ withdraw_fee_percent: 5, withdraw_usdt_fee_usd: 2 })).status, 200);

  const w = await api('POST', '/api/withdrawals', { token: sari.token, body: { diamonds: 100000 } });
  assert.equal(w.body.gross, 254987);
  assert.equal(w.body.fee, Math.floor(254987 * 0.05));
  assert.equal(w.body.net, 254987 - Math.floor(254987 * 0.05));
  await api('POST', `/api/withdrawals/${w.body.id}/cancel`, { token: sari.token });

  // maria: batalkan yang lama, ajukan lagi dengan biaya baru
  const mm = (await api('GET', '/api/withdrawals', { token: maria.token })).body;
  await api('POST', `/api/withdrawals/${mm[0].id}/cancel`, { token: maria.token });
  const u = await api('POST', '/api/withdrawals', { token: maria.token, body: { diamonds: 70000 } });
  assert.equal(u.body.fee, Math.floor(1049 * 0.05) + 200, '5% + biaya jaringan US$ 2');
  assert.equal(u.body.net, 1049 - u.body.fee);
  await api('POST', `/api/withdrawals/${u.body.id}/cancel`, { token: maria.token });
  await set({ withdraw_fee_percent: 0, withdraw_usdt_fee_usd: 1 });
});

test('mengganti rekening menahan penarikan 24 jam (cegah pembobolan akun)', async () => {
  const change = await api('PUT', '/api/withdrawals/account', {
    token: sari.token,
    body: { ...BANK, provider: 'GoPay', accountNumber: '081234567890' },
  });
  assert.equal(change.status, 200);
  assert.ok(change.body.cooldownUntil, 'jeda aktif');
  const o = (await api('GET', '/api/withdrawals/options', { token: sari.token })).body;
  assert.equal(o.account.kind, 'ewallet');
  assert.ok(o.account.cooldownUntil);
  const blocked = await api('POST', '/api/withdrawals', { token: sari.token, body: { diamonds: 70000 } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PAYOUT_COOLDOWN');
  assert.equal(await diamonds(sari.id), 1000000);
  await db.query(`UPDATE payout_accounts SET cooldown_until = now() - interval '1 minute' WHERE user_id = $1`, [sari.id]);
  assert.equal((await api('POST', '/api/withdrawals', { token: sari.token, body: { diamonds: 70000 } })).status, 201);
});

test('negara berubah: rekening lama yang tidak cocok metode baru dianggap belum ada', async () => {
  const before = (await api('GET', '/api/withdrawals/options', { token: maria.token })).body;
  assert.equal(before.account.kind, 'crypto');
  await db.query(`UPDATE users SET country_code = 'ID' WHERE id = $1`, [maria.id]);
  const o = (await api('GET', '/api/withdrawals/options', { token: maria.token })).body;
  assert.equal(o.method, 'idr');
  assert.equal(o.account, null, 'alamat USDT tidak dipakai untuk metode Rupiah');
  const req = await api('POST', '/api/withdrawals', { token: maria.token, body: { diamonds: 70000 } });
  assert.equal(req.body.error.code, 'NO_PAYOUT_ACCOUNT');
  await db.query(`UPDATE users SET country_code = 'CO' WHERE id = $1`, [maria.id]);
  assert.equal((await api('GET', '/api/withdrawals/options', { token: maria.token })).body.account.kind, 'crypto');
});

test('admin: daftar per mata uang, alamat lengkap, bayar (TXID) & tolak; hanya admin', async () => {
  assert.equal((await api('GET', '/api/admin/withdrawals', { token: budi.token })).status, 403);
  // maria ajukan USDT lagi; sari (Rupiah) masih menunggu dari tes sebelumnya
  const m = await api('POST', '/api/withdrawals', { token: maria.token, body: { diamonds: 70000 } });
  assert.equal(m.status, 201, JSON.stringify(m.body));

  const list = await api('GET', '/api/admin/withdrawals?status=pending', { token: admin.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 2);
  const wi = list.body.find((w) => w.user.username === 'sari');
  const wu = list.body.find((w) => w.user.username === 'maria');
  assert.equal(wi.currency, 'IDR');
  assert.equal(wi.accountNumber, '081234567890', 'admin melihat nomor lengkap untuk transfer');
  assert.equal(wi.net, idr(70000));
  assert.equal(wu.currency, 'USD');
  assert.equal(wu.accountNumber, TRON, 'admin melihat alamat TRC20 lengkap');
  assert.equal(wu.user.countryCode, 'CO');
  assert.equal(wu.net, 949);

  const stats = await api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(stats.body.pending.withdrawals, 2);
  assert.equal(stats.body.pendingWithdrawIdr, idr(70000));
  assert.equal(stats.body.pendingWithdrawUsdCents, 949);

  // host belum boleh hapus akun saat ada penarikan berjalan
  const del = await api('POST', '/api/account/delete', { token: maria.token, body: { confirm: 'HAPUS', password: 'rahasia123' } });
  assert.equal(del.status, 409);
  assert.equal(del.body.error.code, 'WITHDRAWAL_PENDING');

  // tolak butuh alasan; diamond kembali
  assert.equal((await api('POST', `/api/admin/withdrawals/${wi.id}/reject`, { token: admin.token, body: { reason: 'x' } })).status, 400);
  const before = await diamonds(sari.id);
  const rej = await api('POST', `/api/admin/withdrawals/${wi.id}/reject`, { token: admin.token, body: { reason: 'Nama rekening tidak cocok' } });
  assert.equal(rej.status, 200);
  assert.equal(await diamonds(sari.id), before + 70000, 'diamond dikembalikan');
  assert.equal((await api('POST', `/api/admin/withdrawals/${wi.id}/reject`, { token: admin.token, body: { reason: 'dua kali' } })).status, 404, 'tidak bisa diproses dua kali');
  const mine = (await api('GET', '/api/withdrawals', { token: sari.token })).body;
  assert.equal(mine[0].status, 'rejected');
  assert.equal(mine[0].adminNote, 'Nama rekening tidak cocok');

  // bayar USDT dengan hash transaksi
  const txid = 'a'.repeat(64);
  const pay = await api('POST', `/api/admin/withdrawals/${wu.id}/pay`, { token: admin.token, body: { ref: txid, note: 'Kirim USDT TRC20' } });
  assert.equal(pay.status, 200);
  assert.equal(await diamonds(maria.id), 930000, 'diamond tetap terpotong setelah dibayar');
  assert.equal((await api('POST', `/api/admin/withdrawals/${wu.id}/pay`, { token: admin.token, body: {} })).status, 404);
  assert.equal((await api('POST', `/api/withdrawals/${wu.id}/cancel`, { token: maria.token })).status, 409, 'yang sudah dibayar tidak bisa dibatalkan');
  const paid = await api('GET', '/api/admin/withdrawals?status=paid', { token: admin.token });
  assert.equal(paid.body[0].transferRef, txid);
  assert.equal(paid.body[0].adminNote, 'Kirim USDT TRC20');
  const notes = (await api('GET', '/api/notifications', { token: maria.token })).body;
  assert.ok(notes.some((n) => n.type === 'withdraw' && /terkirim/i.test(n.title) && /\$/.test(n.body)), 'host diberi tahu penarikan terkirim');
  assert.equal((await api('GET', '/api/admin/withdrawals?status=rejected', { token: admin.token })).body.length, 1);
});

test('hapus akun: alamat/rekening dihapus, catatan penarikan hanya menyisakan 4 karakter terakhir', async () => {
  const del = await api('POST', '/api/account/delete', { token: maria.token, body: { confirm: 'HAPUS', password: 'rahasia123' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM payout_accounts WHERE user_id = $1`, [maria.id])).rows[0].n, 0);
  const rows = (await db.query(`SELECT account_number, account_name FROM withdrawals WHERE user_id = $1`, [maria.id])).rows;
  assert.ok(rows.length >= 2);
  for (const r of rows) {
    assert.equal(r.account_number, 'Lj6t');
    assert.equal(r.account_name, '(dihapus)');
  }
});

/**
 * Migrasi 016: komisi agency lama (10% dari total) dihitung ulang menjadi 10% dari penghasilan host.
 * PERINGATAN: database di DATABASE_URL akan DIKOSONGKAN.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL || !/test/.test(process.env.DATABASE_URL)) {
  throw new Error('Set DATABASE_URL ke database khusus test (nama mengandung "test")');
}

const db = require('../src/db');
const { migrate } = require('../src/migrate');

before(async () => {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await migrate();
});
after(async () => {
  await db.pool.end();
});

test('catatan komisi lama dihitung ulang dari penghasilan host; selisih kembali ke platform', async () => {
  const { rows: u } = await db.query(`INSERT INTO users (username, password_hash, display_name, role) VALUES ('hostlama', 'x', 'Host', 'host') RETURNING id`);
  const hostId = u[0].id;
  const { rows: a } = await db.query(`INSERT INTO agencies (name, code, commission_rate) VALUES ('Lama', 'LAMA01', 0.1) RETURNING id`);
  const agencyId = a[0].id;

  // Tiga transaksi lama (komisi dulu = 10% dari TOTAL koin)
  const t = (min) => `2026-01-01 10:0${min}:00+00`;
  const legacy = [
    { source: 'gift', total: 1000, host: 100, agency: 100, platform: 800, ref: 11, at: t(1) },
    { source: 'chat', total: 100, host: 30, agency: 10, platform: 60, ref: 12, at: t(2) },
    { source: 'chat', total: 20, host: 5, agency: 2, platform: 13, ref: 13, at: t(3) }, // 10% x 5 = 0,5 -> 0
  ];
  for (const x of legacy) {
    const refType = x.source === 'gift' ? 'message' : 'conversation';
    await db.query(
      `INSERT INTO ledger (user_id, currency, amount, balance_after, reason, ref_type, ref_id, created_at) VALUES ($1, 'diamond', $2, $2, $3, $4, $5, $6)`,
      [hostId, x.host, `${x.source}_income`, refType, x.ref, x.at]
    );
    await db.query(`INSERT INTO agency_earnings (agency_id, host_id, amount, source, ref_type, ref_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [agencyId, hostId, x.agency, x.source, refType, x.ref, x.at]);
    await db.query(`INSERT INTO platform_earnings (amount, source, ref_type, ref_id, created_at) VALUES ($1, $2, $3, $4, $5)`, [x.platform, x.source, refType, x.ref, x.at]);
  }
  await db.query(`UPDATE agencies SET earnings_total = 112 WHERE id = $1`, [agencyId]);

  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '016_agency_on_host_income.sql'), 'utf8');
  await db.query(sql);

  const { rows: ae } = await db.query(`SELECT ref_id, amount FROM agency_earnings ORDER BY ref_id`);
  assert.deepEqual(ae.map((r) => [Number(r.ref_id), Number(r.amount)]), [[11, 10], [12, 3]], 'gift 10, chat 3, yang menjadi 0 dihapus');
  const { rows: ag } = await db.query(`SELECT earnings_total FROM agencies WHERE id = $1`, [agencyId]);
  assert.equal(Number(ag[0].earnings_total), 13);
  const { rows: pe } = await db.query(`SELECT ref_id, amount FROM platform_earnings ORDER BY ref_id`);
  assert.deepEqual(pe.map((r) => [Number(r.ref_id), Number(r.amount)]), [[11, 890], [12, 67], [13, 15]], 'selisih kembali ke platform');
  // total koin tetap seimbang: host + agency + platform = total
  const total = Number(pe.reduce((s, r) => s + Number(r.amount), 0)) + 135 + 13;
  assert.equal(total, 1000 + 100 + 20);
});

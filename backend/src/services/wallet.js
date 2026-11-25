const { ApiError } = require('../lib/errors');

/**
 * Semua fungsi di sini WAJIB dipanggil di dalam transaksi (client dari db.tx).
 * Baris user dikunci dengan SELECT ... FOR UPDATE sehingga dua permintaan
 * bersamaan tidak bisa memakai saldo yang sama dua kali.
 */

async function lockUsers(client, ids) {
  // Kunci selalu berurutan berdasarkan id untuk menghindari deadlock
  const unique = [...new Set(ids.map(Number))].sort((a, b) => a - b);
  const { rows } = await client.query(
    `SELECT id, coins, diamonds FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [unique]
  );
  const map = new Map(rows.map((r) => [Number(r.id), { coins: Number(r.coins), diamonds: Number(r.diamonds) }]));
  return map;
}

async function change(client, userId, currency, amount, reason, ref = {}) {
  if (!Number.isSafeInteger(amount) || amount === 0) return null;
  const column = currency === 'coin' ? 'coins' : 'diamonds';
  const { rows } = await client.query(
    `UPDATE users SET ${column} = ${column} + $2, updated_at = now()
     WHERE id = $1 AND ${column} + $2 >= 0
     RETURNING ${column} AS balance`,
    [userId, amount]
  );
  if (!rows.length) {
    throw new ApiError(402, 'INSUFFICIENT_COINS', 'Koin tidak cukup');
  }
  const balance = Number(rows[0].balance);
  await client.query(
    `INSERT INTO ledger (user_id, currency, amount, balance_after, reason, ref_type, ref_id, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, currency, amount, balance, reason, ref.type || null, ref.id || null, ref.note || null]
  );
  return balance;
}

const debitCoins = (client, userId, amount, reason, ref) => change(client, userId, 'coin', -amount, reason, ref);
const creditCoins = (client, userId, amount, reason, ref) => change(client, userId, 'coin', amount, reason, ref);
const creditDiamonds = (client, userId, amount, reason, ref) => change(client, userId, 'diamond', amount, reason, ref);
const debitDiamonds = (client, userId, amount, reason, ref) => change(client, userId, 'diamond', -amount, reason, ref);

async function recordPlatform(client, amount, source, ref = {}) {
  if (amount <= 0) return;
  await client.query(
    `INSERT INTO platform_earnings (amount, source, ref_type, ref_id) VALUES ($1, $2, $3, $4)`,
    [amount, source, ref.type || null, ref.id || null]
  );
}

// Bagi koin: bagian host dibulatkan ke bawah, sisanya untuk platform
function split(amount, hostShare) {
  const host = Math.floor(amount * Number(hostShare));
  return { host, platform: amount - host };
}

/**
 * Bagi koin ke host, agency host (jika ada), dan platform.
 *   host_share = bagian host sebelum komisi agency (mis. 0.5)
 *   komisi agency (mis. 0.1 dari total) diambil dari bagian host
 *   -> host 40%, agency 10%, platform 50%
 */
async function payHost(client, hostId, total, settings, source, ref) {
  const hostGross = Math.floor(total * Number(settings.host_share));
  const { rows } = await client.query(
    `SELECT a.id, a.commission_rate FROM users u JOIN agencies a ON a.id = u.agency_id
     WHERE u.id = $1 AND a.active`,
    [hostId]
  );
  const agency = rows[0];
  const agencyCut = agency ? Math.min(hostGross, Math.floor(total * Number(agency.commission_rate))) : 0;
  const host = hostGross - agencyCut;
  const platform = total - hostGross;

  await creditDiamonds(client, hostId, host, `${source}_income`, ref);
  if (agencyCut > 0) {
    await client.query(
      `INSERT INTO agency_earnings (agency_id, host_id, amount, source, ref_type, ref_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [agency.id, hostId, agencyCut, source, ref.type || null, ref.id || null]
    );
    await client.query(`UPDATE agencies SET earnings_total = earnings_total + $2 WHERE id = $1`, [agency.id, agencyCut]);
  }
  await recordPlatform(client, platform, source, ref);
  return { host, agency: agencyCut, platform };
}

async function balances(client, userId) {
  const { rows } = await client.query(`SELECT coins, diamonds FROM users WHERE id = $1`, [userId]);
  return rows.length ? { coins: Number(rows[0].coins), diamonds: Number(rows[0].diamonds) } : null;
}

module.exports = { lockUsers, debitCoins, creditCoins, creditDiamonds, debitDiamonds, recordPlatform, split, payHost, balances };

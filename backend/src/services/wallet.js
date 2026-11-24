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

async function balances(client, userId) {
  const { rows } = await client.query(`SELECT coins, diamonds FROM users WHERE id = $1`, [userId]);
  return rows.length ? { coins: Number(rows[0].coins), diamonds: Number(rows[0].diamonds) } : null;
}

module.exports = { lockUsers, debitCoins, creditCoins, creditDiamonds, debitDiamonds, recordPlatform, split, balances };

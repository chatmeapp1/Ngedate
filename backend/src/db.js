const { Pool, types } = require('pg');

// Kolom DATE dikembalikan apa adanya ("1998-07-25"), tanpa diubah ke zona waktu server
types.setTypeParser(1082, (value) => value);
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
});

const query = (text, params) => pool.query(text, params);

/**
 * Jalankan fn di dalam satu transaksi. Kalau fn melempar error, semua dibatalkan.
 */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };

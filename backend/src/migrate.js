const fs = require('fs');
const path = require('path');
const db = require('./db');

/**
 * Jalankan file SQL di folder migrations/ yang belum pernah dijalankan (urut nama file).
 */
async function migrate() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query(`SELECT name FROM schema_migrations`);
  const done = new Set(rows.map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.tx(async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
    });
    console.log(`[migrate] ${file}`);
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => db.pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

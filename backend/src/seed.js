/**
 * Buat akun admin pertama + daftar gift contoh.
 * Pakai: ADMIN_USERNAME=admin ADMIN_PASSWORD=rahasia123 npm run seed
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const { migrate } = require('./migrate');

const GIFTS = [
  ['Mawar', 10, 'normal', 1, '🌹'],
  ['Hati', 99, 'normal', 2, '❤️'],
  ['Cokelat', 500, 'normal', 3, '🍫'],
  ['Boneka', 2000, 'normal', 4, '🧸'],
  ['Cincin', 10000, 'luxury', 5, '💍'],
  ['Mobil Sport', 50000, 'luxury', 6, '🏎️'],
  ['Kapal Pesiar', 200000, 'luxury', 7, '🛥️'],
  ['Istana', 1000000, 'luxury', 8, '🏰'],
];

async function seed() {
  await migrate();

  const username = (process.env.ADMIN_USERNAME || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (username && password) {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      `INSERT INTO users (username, password_hash, display_name, role)
       VALUES ($1, $2, 'Admin', 'admin')
       ON CONFLICT (username) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash`,
      [username, hash]
    );
    console.log(`[seed] admin "${username}" siap`);
  } else {
    console.log('[seed] ADMIN_USERNAME / ADMIN_PASSWORD kosong, admin tidak dibuat');
  }

  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM gifts`);
  if (rows[0].n === 0) {
    for (const [name, price, category, sort, icon] of GIFTS) {
      await db.query(
        `INSERT INTO gifts (name, price, category, sort_order, icon) VALUES ($1, $2, $3, $4, $5)`,
        [name, price, category, sort, icon]
      );
    }
    console.log(`[seed] ${GIFTS.length} gift contoh ditambahkan`);
  }
}

seed()
  .then(() => db.pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

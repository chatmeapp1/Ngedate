/**
 * KOSONGKAN SELURUH DATABASE lalu siapkan ulang dari nol:
 * tabel dibuat ulang, admin dibuat dari ADMIN_USERNAME/ADMIN_PASSWORD, gift contoh ditambahkan,
 * dan file unggahan (foto/video) dihapus. ID akun mulai lagi dari 100001.
 *
 * Pakai (SEMUA DATA HILANG, tidak bisa dibatalkan):
 *   CONFIRM_RESET=HAPUS-SEMUA-DATA ADMIN_USERNAME=amora ADMIN_PASSWORD=rahasia npm run reset-db
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const storage = require('./lib/storage');

// Hanya file unggahan buatan aplikasi yang dihapus (bukan file lain di folder yang sama)
const UPLOAD_NAME = /^\d{10,}-[0-9a-f]{16}\.(jpg|png|webp|mp4)$/;

async function main() {
  if (process.env.CONFIRM_RESET !== 'HAPUS-SEMUA-DATA') {
    console.error('[reset] DIBATALKAN. Perintah ini menghapus SEMUA data. Untuk melanjutkan, jalankan dengan:');
    console.error('        CONFIRM_RESET=HAPUS-SEMUA-DATA npm run reset-db');
    process.exit(1);
  }

  let target = config.databaseUrl;
  try {
    const u = new URL(config.databaseUrl);
    target = `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch (e) {
    // pakai teks apa adanya
  }
  console.log(`[reset] Menghapus SEMUA data di database ${target} ...`);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  let files = 0;
  for (const name of fs.readdirSync(storage.UPLOAD_DIR)) {
    const full = path.join(storage.UPLOAD_DIR, name);
    if (UPLOAD_NAME.test(name) && fs.statSync(full).isFile()) {
      fs.unlinkSync(full);
      files += 1;
    }
  }
  console.log(`[reset] ${files} file unggahan dihapus dari ${storage.UPLOAD_DIR}`);

  // Migrasi + admin + gift contoh (seed menutup koneksi setelah selesai)
  require('./seed');
}

main().catch((e) => {
  console.error('[reset] gagal:', e.message);
  process.exit(1);
});

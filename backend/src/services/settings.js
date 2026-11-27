const db = require('../db');

const DEFAULTS = {
  // Pembagian hasil: host 30% BERSIH; komisi agency (default 10%, per agency) dibayar dari bagian app
  // -> host 30%, agency 10%, platform 60%.
  host_share: 0.3, // pesan chat berbayar
  // Gift: host menerima 10% dari harga gift; gift bertanda x2 menjadi 20% (pengali diatur per gift di panel admin)
  gift_host_share: 0.1,
  chat_price_min: 0,
  chat_price_max: 10000,
  wa_threshold_min: 10000,
  wa_threshold_max: 100000000,
  reply_window_hours: 24,
  // Penarikan diamond host. 6.667 diamond = 1 USD, yaitu 1 diamond = Rp 2,55 pada Rp 17.000/USD
  // (aman dari rugi: lihat services/economy.js)
  withdraw_diamonds_per_usd: 6667,
  withdraw_usd_idr: 17000, // kurs pembayaran untuk host Indonesia
  withdraw_min_diamonds: 70000, // minimal diamond per penarikan (= sekitar US$ 10,50)
  withdraw_fee_percent: 0, // biaya penarikan (% dari jumlah)
  withdraw_usdt_fee_usd: 1, // biaya jaringan USDT (TRC20) per penarikan, dalam USD
  // Harga jual 1 koin (Rupiah), dipakai menghitung harga otomatis paket koin. Terpisah dari nilai diamond host.
  coin_price_idr: 2,
  // Level (0-10) dan VIP (1-5) dari TOTAL top up koin. Level 0 dimulai dari 0.
  level_thresholds: [0, 2000, 30000, 80000, 150000, 250000, 500000, 1000000, 2000000, 5000000, 10000000],
  vip_thresholds: [300000, 700000, 1400000, 2800000, 4000000],
  // Level host (0-10) dari total PENGHASILAN diamond 7 hari terakhir (bergulir)
  host_level_thresholds: [0, 300, 3000, 5000, 10000, 70000, 150000, 300000, 500000, 1000000, 5000000],
  // Foto/video privat dari host: harga buka maksimum (koin), batas kiriman per host per hari, panjang video maksimum (detik)
  host_media_price_max: 100000,
  host_media_per_day: 30,
  host_video_max_seconds: 300,
  // Kartu pesan gratis (VIP): jumlah per hari, dan diamond untuk host per pesan gratis (dibayar app)
  free_cards_per_day: 5,
  free_card_host_diamonds: 5,
  // Check-in harian (hari 1-7). Semua hadiah dibiayai app, jadi dibuat kecil.
  // Format tiap hari: coins:JUMLAH | cards:JUMLAH (pesan gratis) | frame:MODEL:HARI (bingkai avatar sementara, MODEL 1 atau 2)
  checkin_rewards: ['coins:10', 'frame:1:3', 'cards:5', 'coins:10', 'cards:5', 'frame:2:3', 'coins:100'],
  // Tugas host: hadiah DIAMOND (dibayar app, bisa ditarik host, jadi buat kecil) dan target sukai per hari
  task_reward_moment: 100,
  task_reward_photos: 600,
  task_reward_checkin: 10,
  task_reward_like: 20,
  task_like_target: 50,
  // Foto & video di chat untuk VIP: batas kiriman per hari (cegah penyalahgunaan penyimpanan)
  vip_media_per_day: 30,
  // Top up koin: pemesanan lewat WhatsApp admin (sampai Google Play Billing dipasang)
  topup_contact: '', // nomor WhatsApp admin, hanya angka dengan kode negara (mis. 6281234567890)
  topup_note: 'Pilih paket, lalu pesan lewat WhatsApp admin. Koin ditambahkan setelah pembayaran dikonfirmasi.',
};

async function getSettings(client = db) {
  const { rows } = await client.query(`SELECT key, value FROM settings`);
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function updateSettings(patch) {
  const allowed = Object.keys(DEFAULTS);
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) continue;
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }
  return getSettings();
}

module.exports = { getSettings, updateSettings, DEFAULTS };

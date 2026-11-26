const db = require('../db');

const DEFAULTS = {
  // Pembagian hasil: host 30% BERSIH; komisi agency (default 10%, per agency) dibayar dari bagian app
  // -> host 30%, agency 10%, platform 60%.
  host_share: 0.3,
  chat_price_min: 0,
  chat_price_max: 10000,
  wa_threshold_min: 10000,
  wa_threshold_max: 100000000,
  reply_window_hours: 24,
  // Penarikan diamond host. 6.667 diamond = 1 USD (sama dengan harga jual koin ~ Rp 2,55 pada Rp 17.000/USD)
  withdraw_diamonds_per_usd: 6667,
  withdraw_usd_idr: 17000, // kurs pembayaran untuk host Indonesia
  withdraw_min_diamonds: 70000, // minimal diamond per penarikan (= sekitar US$ 10,50)
  withdraw_fee_percent: 0, // biaya penarikan (% dari jumlah)
  withdraw_usdt_fee_usd: 1, // biaya jaringan USDT (TRC20) per penarikan, dalam USD
  // Harga jual 1 koin (Rupiah), dipakai menghitung harga otomatis paket koin. Terpisah dari nilai diamond host.
  coin_price_idr: 2,
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

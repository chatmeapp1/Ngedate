const db = require('../db');

const DEFAULTS = {
  host_share: 0.5,
  chat_price_min: 0,
  chat_price_max: 10000,
  wa_threshold_min: 10000,
  wa_threshold_max: 100000000,
  reply_window_hours: 24,
  // Penarikan diamond host (nilai awal, ubah di panel admin > Pengaturan)
  // 1 koin dijual Rp 2; host+agency mendapat 50% dalam diamond, jadi 1 diamond = Rp 2 menjaga margin.
  withdraw_rate_idr: 2, // rupiah per 1 diamond
  withdraw_min_diamonds: 50000, // minimal diamond per penarikan (= Rp 100.000)
  withdraw_fee_percent: 0, // biaya penarikan (% dari jumlah rupiah)
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

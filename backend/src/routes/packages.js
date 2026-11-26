const express = require('express');
const db = require('../db');
const { getSettings } = require('../services/settings');
const { wrap } = require('../lib/errors');

const router = express.Router();

/**
 * Daftar paket koin untuk layar Top up.
 * Mata uang mengikuti negara di profil: Indonesia -> Rupiah, negara lain -> USD.
 */
router.get('/', wrap(async (req, res) => {
  const [{ rows: pk }, { rows: me }, settings] = await Promise.all([
    db.query(`SELECT id, coins, price_idr, price_usd_cents, badge FROM coin_packages WHERE active ORDER BY sort_order, coins`),
    db.query(`SELECT country_code FROM users WHERE id = $1`, [req.user.id]),
    getSettings(),
  ]);
  const isId = String((me[0] && me[0].country_code) || '').trim().toUpperCase() === 'ID';
  res.json({
    currency: isId ? 'IDR' : 'USD',
    contact: settings.topup_contact || null,
    note: settings.topup_note || '',
    packages: pk.map((r) => ({
      id: r.id,
      coins: Number(r.coins),
      priceIdr: Number(r.price_idr),
      priceUsdCents: r.price_usd_cents,
      badge: r.badge,
    })),
  });
}));

module.exports = router;

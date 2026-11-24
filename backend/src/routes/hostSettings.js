const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap, badRequest } = require('../lib/errors');
const { getSettings } = require('../services/settings');

const router = express.Router();

function map(r) {
  return {
    chatPrice: Number(r.chat_price),
    waEnabled: r.wa_enabled,
    waNumber: r.wa_number,
    waUnlockThreshold: Number(r.wa_unlock_threshold),
  };
}

async function load(userId) {
  const { rows } = await db.query(
    `INSERT INTO host_profiles (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING *`,
    [userId]
  );
  return rows[0];
}

router.get('/', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({
    ...map(await load(req.user.id)),
    limits: {
      chatPriceMin: Number(s.chat_price_min),
      chatPriceMax: Number(s.chat_price_max),
      waThresholdMin: Number(s.wa_threshold_min),
      waThresholdMax: Number(s.wa_threshold_max),
    },
  });
}));

router.patch('/', wrap(async (req, res) => {
  const s = await getSettings();
  const b = req.body || {};
  const current = await load(req.user.id);

  const chatPrice = v.int(b.chatPrice, 'Tarif chat', {
    min: Number(s.chat_price_min), max: Number(s.chat_price_max), optional: true,
  });
  const waThreshold = v.int(b.waUnlockThreshold, 'Syarat buka WA', {
    min: Number(s.wa_threshold_min), max: Number(s.wa_threshold_max), optional: true,
  });
  const waEnabled = v.bool(b.waEnabled, 'Aktifkan WA', { optional: true });
  let waNumber = v.str(b.waNumber, 'Nomor WA', { max: 20, optional: true, pattern: /^\+?[0-9\s-]{9,20}$/ });
  if (waNumber) waNumber = waNumber.replace(/[\s-]/g, '');

  const finalEnabled = waEnabled ?? current.wa_enabled;
  const finalNumber = waNumber ?? current.wa_number;
  if (finalEnabled && !finalNumber) {
    throw badRequest('Isi nomor WhatsApp dulu sebelum mengaktifkan', 'WA_NUMBER_REQUIRED');
  }

  const { rows } = await db.query(
    `UPDATE host_profiles SET
       chat_price = COALESCE($2, chat_price),
       wa_unlock_threshold = COALESCE($3, wa_unlock_threshold),
       wa_enabled = $4,
       wa_number = $5,
       updated_at = now()
     WHERE user_id = $1 RETURNING *`,
    [req.user.id, chatPrice ?? null, waThreshold ?? null, finalEnabled, finalNumber]
  );
  res.json(map(rows[0]));
}));

module.exports = router;

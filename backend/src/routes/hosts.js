const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap, notFound } = require('../lib/errors');
const { hostCard } = require('./serializers');

const router = express.Router();

const HOST_SELECT = `
  SELECT u.*, hp.chat_price, hp.wa_enabled, hp.wa_number, hp.wa_unlock_threshold
  FROM users u LEFT JOIN host_profiles hp ON hp.user_id = u.id
  WHERE u.role = 'host' AND u.status = 'active'`;

// Daftar host: yang terakhir aktif di atas
router.get('/', wrap(async (req, res) => {
  const page = v.int(req.query.page ?? 1, 'page', { min: 1, max: 1000 });
  const { rows } = await db.query(
    `${HOST_SELECT} ORDER BY u.last_seen_at DESC NULLS LAST, u.id DESC LIMIT 30 OFFSET $1`,
    [(page - 1) * 30]
  );
  res.json(rows.map(hostCard));
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows } = await db.query(`${HOST_SELECT} AND u.id = $1`, [v.id(req.params.id)]);
  if (!rows.length) throw notFound('Host tidak ditemukan');
  res.json(hostCard(rows[0]));
}));

module.exports = router;

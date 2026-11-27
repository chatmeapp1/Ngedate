const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const realtime = require('../realtime');
const safety = require('../services/safety');
const { getSettings } = require('../services/settings');
const { weekIncomeSql } = require('../services/membership');
const { wrap, notFound } = require('../lib/errors');
const { hostCard } = require('./serializers');

/**
 * Match: tumpukan kartu host yang bisa digeser. Geser kanan / hati = suka (memakai /api/users/:id/like),
 * geser kiri / X = lewati (disembunyikan SKIP_DAYS hari). Host yang sudah disukai tidak muncul lagi.
 */
const router = express.Router();
const SKIP_DAYS = 3;

router.get('/deck', wrap(async (req, res) => {
  const limit = v.int(req.query.limit, 'limit', { min: 1, max: 20, optional: true }) || 10;
  const me = req.user.id;
  const online = realtime.presentUserIds();
  const { rows } = await db.query(
    `SELECT u.*, hp.chat_price, hp.wa_enabled, hp.wa_number, hp.wa_unlock_threshold, ${weekIncomeSql('u.id')} AS week_income,
       COALESCE((SELECT json_agg(p.url ORDER BY p.sort_order, p.id) FROM (
         SELECT url, sort_order, id FROM user_photos WHERE user_id = u.id AND status = 'approved' ORDER BY sort_order, id LIMIT 5) p), '[]'::json) AS photo_urls
     FROM users u LEFT JOIN host_profiles hp ON hp.user_id = u.id
     WHERE u.role = 'host' AND u.status = 'active' AND u.host_status = 'approved' AND u.gender IS DISTINCT FROM 'male'
       AND u.id <> $1 AND (u.avatar_url IS NOT NULL OR EXISTS (SELECT 1 FROM user_photos WHERE user_id = u.id AND status = 'approved'))
       AND ${safety.notBlockedSql('u', 1)}
       AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.user_id = $1 AND l.target_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM match_skips s WHERE s.user_id = $1 AND s.host_id = u.id AND s.created_at > now() - interval '${SKIP_DAYS} days')
     ORDER BY (u.id = ANY($2::bigint[])) DESC, random() LIMIT ${limit}`,
    [me, online]
  );
  const { host_level_thresholds: th } = await getSettings();
  res.json(rows.map((r) => ({ ...hostCard(r, th), photos: r.photo_urls })));
}));

router.post('/:id/skip', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  const { rows } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'host'`, [id]);
  if (!rows.length) throw notFound('Host tidak ditemukan');
  await db.query(
    `INSERT INTO match_skips (user_id, host_id) VALUES ($1, $2) ON CONFLICT (user_id, host_id) DO UPDATE SET created_at = now()`,
    [req.user.id, id]
  );
  res.json({ ok: true });
}));

module.exports = router;

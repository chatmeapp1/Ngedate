const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap, badRequest } = require('../lib/errors');
const { publicUser } = require('./serializers');
const storage = require('../lib/storage');

const MAX_PHOTOS = 12;

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  res.json(publicUser(rows[0], { self: true }));
}));

router.patch('/', wrap(async (req, res) => {
  const b = req.body || {};
  const fields = {
    display_name: v.str(b.displayName, 'Nama', { min: 1, max: 50, optional: true }),
    avatar_url: v.str(b.avatarUrl, 'Foto', { max: 500, optional: true, pattern: /^https?:\/\// }),
    bio: v.str(b.bio, 'Bio', { max: 500, optional: true }),
    gender: v.str(b.gender, 'Gender', { optional: true, pattern: /^(male|female|other)$/ }),
    birth_date: v.str(b.birthDate, 'Tanggal lahir', { optional: true, pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    country_code: v.str(b.countryCode, 'Negara', { optional: true, pattern: /^[A-Za-z]{2}$/ }),
  };
  if (fields.country_code) fields.country_code = fields.country_code.toUpperCase();
  if (fields.birth_date) {
    const d = new Date(fields.birth_date);
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() - 18);
    if (Number.isNaN(d.getTime())) throw badRequest('Tanggal lahir tidak valid');
    if (d > limit) throw badRequest('Minimal umur 18 tahun', 'UNDERAGE');
  }
  const sets = [];
  const params = [req.user.id];
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    params.push(val);
    sets.push(col + ' = $' + params.length);
  }
  if (sets.length) {
    await db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  }
  const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  res.json(publicUser(rows[0], { self: true }));
}));

// Ganti foto profil (multipart, field "file")
router.post('/avatar', storage.single, wrap(async (req, res) => {
  const { url } = await storage.save(req);
  const { rows: old } = await db.query(`SELECT avatar_url FROM users WHERE id = $1`, [req.user.id]);
  const { rows } = await db.query(
    `UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.user.id, url]
  );
  if (old[0] && old[0].avatar_url) await storage.remove(old[0].avatar_url);
  res.json(publicUser(rows[0], { self: true }));
}));

// Album foto
router.get('/photos', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT id, url FROM user_photos WHERE user_id = $1 ORDER BY sort_order, id`, [req.user.id]);
  res.json(rows.map((p) => ({ id: Number(p.id), url: p.url })));
}));

router.post('/photos', storage.single, wrap(async (req, res) => {
  const { rows: c } = await db.query(`SELECT COUNT(*)::int AS n FROM user_photos WHERE user_id = $1`, [req.user.id]);
  if (c[0].n >= MAX_PHOTOS) throw badRequest(`Maksimal ${MAX_PHOTOS} foto`, 'TOO_MANY_PHOTOS');
  const { url } = await storage.save(req);
  const { rows } = await db.query(
    `INSERT INTO user_photos (user_id, url, sort_order) VALUES ($1, $2, $3) RETURNING id, url`,
    [req.user.id, url, c[0].n]
  );
  res.status(201).json({ id: Number(rows[0].id), url: rows[0].url });
}));

router.delete('/photos/:id', wrap(async (req, res) => {
  const { rows } = await db.query(
    `DELETE FROM user_photos WHERE id = $1 AND user_id = $2 RETURNING url`,
    [v.id(req.params.id), req.user.id]
  );
  if (rows.length) await storage.remove(rows[0].url);
  res.json({ ok: true });
}));

module.exports = router;

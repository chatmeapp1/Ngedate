const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap, badRequest } = require('../lib/errors');
const { publicUser } = require('./serializers');

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
  };
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

module.exports = router;

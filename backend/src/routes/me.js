const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap, badRequest, conflict } = require('../lib/errors');
const { publicUser } = require('./serializers');
const storage = require('../lib/storage');
const membership = require('../services/membership');

const MAX_PHOTOS = 12;
const LANGUAGES = ['id', 'en', 'ms', 'th', 'vi', 'tl', 'zh', 'ja', 'ko', 'ar', 'hi', 'es', 'pt'];

const router = express.Router();

// Profil sendiri + nama agency + status verifikasi terakhir
async function loadMe(userId) {
  const { rows } = await db.query(
    `SELECT u.*, a.name AS agency_name,
            (SELECT status FROM verifications WHERE user_id = u.id ORDER BY id DESC LIMIT 1) AS verification_status
     FROM users u LEFT JOIN agencies a ON a.id = u.agency_id
     WHERE u.id = $1`,
    [userId]
  );
  const out = publicUser(rows[0], { self: true });
  out.membership = await membership.summary(db, userId);
  return out;
}

function validateBirthDate(value) {
  const d = new Date(value);
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - 18);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) throw badRequest('Tanggal lahir tidak valid');
  if (d > limit) throw badRequest('Minimal umur 18 tahun', 'UNDERAGE');
}

function parseTags(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 8) throw badRequest('Maksimal 8 tag');
  return [...new Set(raw.map((t) => v.str(t, 'Tag', { min: 1, max: 20 }).toLowerCase()))];
}

// Token notifikasi push perangkat ini (satu token hanya milik satu akun)
router.post('/push-token', wrap(async (req, res) => {
  const token = v.str(req.body.token, 'token', { min: 20, max: 400 });
  await db.query(
    `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, 'android')
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()`,
    [token, req.user.id]
  );
  res.json({ ok: true });
}));

router.delete('/push-token', wrap(async (req, res) => {
  const token = v.str(req.query.token, 'token', { min: 20, max: 400 });
  await db.query(`DELETE FROM push_tokens WHERE token = $1 AND user_id = $2`, [token, req.user.id]);
  res.json({ ok: true });
}));

router.get('/', wrap(async (req, res) => {
  res.json(await loadMe(req.user.id));
}));

router.patch('/', wrap(async (req, res) => {
  const b = req.body || {};
  const { rows: cur } = await db.query(`SELECT gender, profile_completed FROM users WHERE id = $1`, [req.user.id]);

  // Jenis kelamin dikunci setelah diisi
  if (b.gender !== undefined && cur[0].gender && b.gender !== cur[0].gender) {
    throw conflict('Jenis kelamin tidak bisa diubah', 'GENDER_LOCKED');
  }

  const fields = {
    display_name: v.str(b.displayName, 'Nama', { min: 1, max: 50, optional: true }),
    bio: v.str(b.bio, 'Bio', { max: 500, optional: true }),
    gender: cur[0].gender ? undefined : v.str(b.gender, 'Gender', { optional: true, pattern: /^(male|female)$/ }),
    birth_date: v.str(b.birthDate, 'Tanggal lahir', { optional: true, pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    country_code: v.str(b.countryCode, 'Negara', { optional: true, pattern: /^[A-Za-z]{2}$/ }),
    language: v.str(b.language, 'Bahasa', { optional: true, pattern: new RegExp(`^(${LANGUAGES.join('|')})$`) }),
    tags: parseTags(b.tags),
  };
  if (fields.country_code) fields.country_code = fields.country_code.toUpperCase();
  if (fields.birth_date) validateBirthDate(fields.birth_date);

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
  res.json(await loadMe(req.user.id));
}));

// Ganti foto profil (multipart, field "file").
// Host: masuk antrean cek admin (pending_avatar_url), foto lama tetap tampil sampai disetujui.
router.post('/avatar', storage.single, wrap(async (req, res) => {
  const { url } = await storage.save(req);
  const { rows } = await db.query(
    `SELECT role, avatar_url, pending_avatar_url FROM users WHERE id = $1`,
    [req.user.id]
  );
  const me = rows[0];
  if (me.role === 'host') {
    await db.query(`UPDATE users SET pending_avatar_url = $2, updated_at = now() WHERE id = $1`, [req.user.id, url]);
    if (me.pending_avatar_url) await storage.remove(me.pending_avatar_url);
  } else {
    await db.query(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1`, [req.user.id, url]);
    if (me.avatar_url) await storage.remove(me.avatar_url);
  }
  res.json(await loadMe(req.user.id));
}));

// Album foto: pemilik melihat semua foto beserta status ceknya
router.get('/photos', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, url, status, reject_reason FROM user_photos WHERE user_id = $1 ORDER BY sort_order, id`,
    [req.user.id]
  );
  res.json(rows.map((p) => ({ id: Number(p.id), url: p.url, status: p.status, rejectReason: p.reject_reason })));
}));

router.post('/photos', storage.single, wrap(async (req, res) => {
  const { rows: c } = await db.query(`SELECT COUNT(*)::int AS n FROM user_photos WHERE user_id = $1`, [req.user.id]);
  if (c[0].n >= MAX_PHOTOS) throw badRequest(`Maksimal ${MAX_PHOTOS} foto`, 'TOO_MANY_PHOTOS');
  const { url } = await storage.save(req);
  const status = req.user.role === 'host' ? 'pending' : 'approved';
  const { rows } = await db.query(
    `INSERT INTO user_photos (user_id, url, sort_order, status) VALUES ($1, $2, $3, $4)
     RETURNING id, url, status`,
    [req.user.id, url, c[0].n, status]
  );
  res.status(201).json({ id: Number(rows[0].id), url: rows[0].url, status: rows[0].status, rejectReason: null });
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
module.exports.loadMe = loadMe;
module.exports.validateBirthDate = validateBirthDate;
module.exports.LANGUAGES = LANGUAGES;

const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const storage = require('../lib/storage');
const { randomSteps, describe } = require('../lib/gestures');
const { wrap, badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const { loadMe, validateBirthDate } = require('./me');

const router = express.Router();

const CHALLENGE_TTL_SECONDS = 180;   // tantangan harus diselesaikan dalam 3 menit
const STEPS = 3;

async function findAgency(code) {
  const { rows } = await db.query(
    `SELECT id, name FROM agencies WHERE code = $1 AND active`,
    [String(code || '').trim().toUpperCase()]
  );
  return rows[0] || null;
}

// Cek kode undangan agency (dipakai aplikasi untuk menampilkan nama agency)
router.get('/agency/:code', wrap(async (req, res) => {
  const agency = await findAgency(req.params.code);
  if (!agency) throw notFound('Kode undangan tidak valid', 'INVALID_INVITE');
  res.json({ name: agency.name });
}));

/**
 * Lengkapi profil (sekali saja, setelah login pertama).
 *   male   -> user biasa
 *   female -> host (wajib kode undangan agency), status "pending" sampai verifikasi wajah disetujui admin
 * Foto profil wajib sudah diunggah lewat POST /api/me/avatar sebelumnya.
 */
router.post('/complete', wrap(async (req, res) => {
  const b = req.body || {};
  const gender = v.str(b.gender, 'Jenis kelamin', { pattern: /^(male|female)$/ });
  const displayName = v.str(b.displayName, 'Nickname', { min: 2, max: 30 });
  const birthDate = v.str(b.birthDate, 'Tanggal lahir', { pattern: /^\d{4}-\d{2}-\d{2}$/ });
  validateBirthDate(birthDate);

  await db.tx(async (client) => {
    const { rows } = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [req.user.id]);
    const me = rows[0];
    if (me.profile_completed) throw conflict('Profil sudah dilengkapi', 'ALREADY_COMPLETED');
    if (me.role === 'admin') throw forbidden('Admin tidak perlu melengkapi profil');
    if (!me.avatar_url) throw badRequest('Unggah foto profil dulu', 'AVATAR_REQUIRED');

    if (gender === 'male') {
      await client.query(
        `UPDATE users SET gender = 'male', display_name = $2, birth_date = $3,
           profile_completed = true, updated_at = now() WHERE id = $1`,
        [me.id, displayName, birthDate]
      );
      return;
    }

    const agency = await findAgency(b.inviteCode);
    if (!agency) throw badRequest('Kode undangan agency tidak valid', 'INVALID_INVITE');
    await client.query(
      `UPDATE users SET gender = 'female', display_name = $2, birth_date = $3, role = 'host',
         host_status = 'pending', agency_id = $4, profile_completed = true, updated_at = now()
       WHERE id = $1`,
      [me.id, displayName, birthDate, agency.id]
    );
    await client.query(`INSERT INTO host_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [me.id]);
  });

  res.json(await loadMe(req.user.id));
}));

async function requireHostToVerify(userId) {
  const { rows } = await db.query(
    `SELECT role, host_status, verified,
            (SELECT status FROM verifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1) AS last_status
     FROM users WHERE id = $1`,
    [userId]
  );
  const me = rows[0];
  if (me.role !== 'host') throw forbidden('Verifikasi wajah hanya untuk host');
  if (me.verified) throw conflict('Akun sudah terverifikasi', 'ALREADY_VERIFIED');
  if (me.last_status === 'pending') throw conflict('Verifikasi sedang ditinjau', 'VERIFICATION_PENDING');
  return me;
}

// Minta tantangan baru: 3 gerakan acak, sekali pakai, berlaku 3 menit
router.post('/verification/challenge', wrap(async (req, res) => {
  await requireHostToVerify(req.user.id);
  const steps = randomSteps(STEPS);
  await db.query(`UPDATE verification_challenges SET used = true WHERE user_id = $1 AND NOT used`, [req.user.id]);
  const { rows } = await db.query(
    `INSERT INTO verification_challenges (user_id, steps, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3)) RETURNING id, expires_at`,
    [req.user.id, steps, CHALLENGE_TTL_SECONDS]
  );
  res.status(201).json({ challengeId: Number(rows[0].id), steps: describe(steps), expiresAt: rows[0].expires_at });
}));

// Kirim 3 foto (field "photos", urut sesuai gerakan) + challengeId
router.post('/verification', storage.many(STEPS), wrap(async (req, res) => {
  await requireHostToVerify(req.user.id);
  const challengeId = v.id(req.body.challengeId, 'challengeId');
  const files = req.files || [];
  if (files.length !== STEPS) throw badRequest(`Kirim tepat ${STEPS} foto`, 'PHOTOS_REQUIRED');

  const verification = await db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM verification_challenges WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [challengeId, req.user.id]
    );
    const ch = rows[0];
    if (!ch || ch.used) throw badRequest('Tantangan tidak valid, ulangi verifikasi', 'CHALLENGE_INVALID');
    if (new Date(ch.expires_at) < new Date()) throw badRequest('Waktu habis, ulangi verifikasi', 'CHALLENGE_EXPIRED');

    const urls = [];
    for (const f of files) urls.push((await storage.saveFile(req, f)).url);
    await client.query(`UPDATE verification_challenges SET used = true WHERE id = $1`, [ch.id]);
    const { rows: ins } = await client.query(
      `INSERT INTO verifications (user_id, challenge_id, steps, photo_urls, duration_ms)
       VALUES ($1, $2, $3, $4, (EXTRACT(EPOCH FROM (now() - $5::timestamptz)) * 1000)::int)
       RETURNING id, status, created_at`,
      [req.user.id, ch.id, ch.steps, urls, ch.created_at]
    );
    return ins[0];
  });

  res.status(201).json({ id: Number(verification.id), status: verification.status });
}));

router.get('/verification', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, status, reject_reason, created_at FROM verifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
    [req.user.id]
  );
  const r = rows[0];
  res.json(r ? { id: Number(r.id), status: r.status, rejectReason: r.reject_reason, createdAt: r.created_at } : { status: 'none' });
}));

module.exports = router;

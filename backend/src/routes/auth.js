const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const v = require('../lib/validate');
const { wrap, unauthorized, forbidden, conflict } = require('../lib/errors');
const tokens = require('../lib/tokens');
const { authenticate } = require('../middleware/auth');
const { publicUser } = require('./serializers');

const router = express.Router();

// Batasi percobaan login/daftar supaya tidak bisa ditebak paksa
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

async function issueSession(user) {
  return {
    accessToken: tokens.signAccessToken(user),
    refreshToken: await tokens.issueRefreshToken(user.id),
    user: publicUser(user, { self: true }),
  };
}

// Daftar: selalu sebagai "user". Akun host dibuat/dinaikkan oleh admin.
router.post('/register', limiter, wrap(async (req, res) => {
  const username = v.str(req.body.username, 'Username', { min: 3, max: 30, pattern: /^(?!\d+$)[a-zA-Z0-9_.]+$/ }).toLowerCase();
  const password = v.str(req.body.password, 'Password', { min: 6, max: 100 });
  const displayName = v.str(req.body.displayName ?? username, 'Nama', { min: 1, max: 50 });
  const email = v.str(req.body.email, 'Email', { max: 120, optional: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
  const country = v.str(req.body.countryCode, 'Negara', { optional: true, pattern: /^[A-Za-z]{2}$/ });

  const hash = await bcrypt.hash(password, 10);
  let user;
  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, email, password_hash, display_name, country_code)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [username, email ? email.toLowerCase() : null, hash, displayName, country ? country.toUpperCase() : null]
    );
    user = rows[0];
  } catch (e) {
    if (e.code === '23505') throw conflict('Username atau email sudah dipakai', 'ALREADY_EXISTS');
    throw e;
  }
  res.status(201).json(await issueSession(user));
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const login = v.str(req.body.login, 'ID pengguna', { max: 120 }).toLowerCase();
  const password = v.str(req.body.password, 'Password', { max: 100 });
  // Angka saja = ID pengguna (cara masuk utama). Selain itu username/email (akun lama & admin).
  const byId = /^\d{1,15}$/.test(login);
  const { rows } = byId
    ? await db.query(`SELECT * FROM users WHERE id = $1`, [login])
    : await db.query(`SELECT * FROM users WHERE username = $1 OR email = $1`, [login]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw unauthorized('ID atau password salah', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') throw forbidden('Akun ditangguhkan', 'SUSPENDED');
  res.json(await issueSession(user));
}));

// Lupa password: ID + kode pemulihan + password baru. Dibatasi percobaan; galat sama untuk semua kegagalan.
router.post('/forgot/reset', limiter, wrap(async (req, res) => {
  const b = req.body || {};
  const out = await require('../services/account').resetWithRecovery({ login: b.login, code: b.code, newPassword: b.newPassword });
  res.json({ ok: true, ...out });
}));

// Kontak admin untuk bantuan akun (publik, supaya terlihat di layar Lupa password)
router.get('/support', wrap(async (req, res) => {
  const { getSettings } = require('../services/settings');
  const s = await getSettings();
  res.json({ whatsapp: s.topup_contact || '' });
}));

// Login cepat tanpa username/password. Akun terikat ke device key dari aplikasi.
router.post('/quick', limiter, wrap(async (req, res) => {
  const deviceKey = v.str(req.body.deviceKey, 'deviceKey', { min: 32, max: 128, pattern: /^[A-Za-z0-9_-]+$/ });
  const country = v.str(req.body.countryCode, 'Negara', { optional: true, pattern: /^[A-Za-z]{2}$/ });
  const deviceHash = crypto.createHash('sha256').update(deviceKey).digest('hex');

  const { user, isNew } = await db.tx(async (client) => {
    const { rows: found } = await client.query(
      `UPDATE device_accounts SET last_used_at = now() WHERE device_hash = $1 RETURNING user_id`,
      [deviceHash]
    );
    if (found.length) {
      const { rows } = await client.query(`SELECT * FROM users WHERE id = $1`, [found[0].user_id]);
      return { user: rows[0], isNew: false };
    }
    // Akun baru: username acak, password acak (tidak dipakai untuk login cepat)
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    for (let attempt = 0; attempt < 5; attempt++) {
      const digits = String(crypto.randomInt(10000000, 99999999));
      await client.query('SAVEPOINT pick_username');
      try {
        const { rows } = await client.query(
          `INSERT INTO users (username, password_hash, display_name, country_code, password_set)
           VALUES ($1, $2, $3, $4, false) RETURNING *`,
          [`amora${digits}`, hash, `Amora ${digits.slice(-4)}`, country ? country.toUpperCase() : null]
        );
        await client.query(`INSERT INTO device_accounts (device_hash, user_id) VALUES ($1, $2)`, [deviceHash, rows[0].id]);
        return { user: rows[0], isNew: true };
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT pick_username');
        if (e.code !== '23505') throw e;
        // Perangkat yang sama login bersamaan: pakai akun yang baru saja dibuat
        if (e.constraint === 'device_accounts_pkey') {
          const { rows } = await client.query(
            `SELECT u.* FROM device_accounts d JOIN users u ON u.id = d.user_id WHERE d.device_hash = $1`,
            [deviceHash]
          );
          if (rows.length) return { user: rows[0], isNew: false };
        }
      }
    }
    throw new Error('Gagal membuat akun, coba lagi');
  });

  if (!user || user.status !== 'active') throw forbidden('Akun ditangguhkan', 'SUSPENDED');
  res.status(isNew ? 201 : 200).json({ ...(await issueSession(user)), isNew });
}));

router.post('/refresh', wrap(async (req, res) => {
  const token = v.str(req.body.refreshToken, 'refreshToken', { max: 200 });
  const rotated = await tokens.rotateRefreshToken(token);
  if (!rotated) throw unauthorized('Sesi habis, silakan login lagi', 'REFRESH_INVALID');
  const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [rotated.userId]);
  if (!rows.length || rows[0].status !== 'active') throw forbidden('Akun ditangguhkan', 'SUSPENDED');
  res.json({ accessToken: tokens.signAccessToken(rows[0]), refreshToken: rotated.refreshToken });
}));

router.post('/logout', authenticate, wrap(async (req, res) => {
  if (req.body && req.body.refreshToken) await tokens.revokeRefreshToken(String(req.body.refreshToken));
  res.json({ ok: true });
}));

module.exports = router;

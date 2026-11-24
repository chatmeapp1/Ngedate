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
  const username = v.str(req.body.username, 'Username', { min: 3, max: 30, pattern: /^[a-zA-Z0-9_.]+$/ }).toLowerCase();
  const password = v.str(req.body.password, 'Password', { min: 6, max: 100 });
  const displayName = v.str(req.body.displayName ?? username, 'Nama', { min: 1, max: 50 });
  const email = v.str(req.body.email, 'Email', { max: 120, optional: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });

  const hash = await bcrypt.hash(password, 10);
  let user;
  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [username, email ? email.toLowerCase() : null, hash, displayName]
    );
    user = rows[0];
  } catch (e) {
    if (e.code === '23505') throw conflict('Username atau email sudah dipakai', 'ALREADY_EXISTS');
    throw e;
  }
  res.status(201).json(await issueSession(user));
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const login = v.str(req.body.login, 'Username/email', { max: 120 }).toLowerCase();
  const password = v.str(req.body.password, 'Password', { max: 100 });
  const { rows } = await db.query(`SELECT * FROM users WHERE username = $1 OR email = $1`, [login]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw unauthorized('Username atau password salah', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') throw forbidden('Akun ditangguhkan', 'SUSPENDED');
  res.json(await issueSession(user));
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

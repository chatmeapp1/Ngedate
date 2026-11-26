const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const panel = require('../services/agencyPanel');
const { verifyAgencyToken } = require('../lib/tokens');
const { wrap, unauthorized, forbidden } = require('../lib/errors');

/**
 * Panel agency (/agency di web). Login terpisah dari pengguna app dan admin:
 * token agency tidak berlaku di API lain, dan token pengguna/admin tidak berlaku di sini.
 */
const router = express.Router();

// Batasi percobaan login (menebak password)
router.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  wrap(async (req, res) => {
    res.json(await panel.login(req.body.username, req.body.password));
  })
);

async function authenticateAgency(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw unauthorized();
    let payload;
    try {
      payload = verifyAgencyToken(header.slice(7));
    } catch (e) {
      throw unauthorized(e.name === 'TokenExpiredError' ? 'Sesi habis, masuk lagi' : 'Token tidak valid', e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
    }
    const { rows } = await db.query(`SELECT id, active, password_hash, password_changed_at FROM agencies WHERE id = $1`, [payload.id]);
    const a = rows[0];
    if (!a || !a.password_hash) throw unauthorized('Agency tidak ditemukan');
    if (!a.active) throw forbidden('Agency dinonaktifkan', 'AGENCY_DISABLED');
    // Ganti password mencabut semua sesi sebelumnya
    if (payload.issuedAt * 1000 < new Date(a.password_changed_at).getTime() - 1000) throw unauthorized('Sesi habis, masuk lagi', 'TOKEN_EXPIRED');
    req.agency = { id: Number(a.id) };
    next();
  } catch (err) {
    next(err);
  }
}

router.use(authenticateAgency);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

router.get('/overview', wrap(async (req, res) => res.json(await panel.overview(req.agency.id))));
router.get('/hosts', wrap(async (req, res) => res.json(await panel.hosts(req.agency.id))));
router.get('/earnings', wrap(async (req, res) => res.json(await panel.earnings(req.agency.id))));

router.post('/password', wrap(async (req, res) => res.json(await panel.changePassword(req.agency.id, req.body || {}))));

router.get('/withdraw/options', wrap(async (req, res) => res.json(await panel.withdrawOptions(req.agency.id))));
router.put('/withdraw/account', wrap(async (req, res) => res.json({ ok: true, ...(await panel.saveAccount(req.agency.id, req.body || {})) })));
router.get('/withdraw', wrap(async (req, res) => res.json(await panel.listWithdrawals(req.agency.id))));
router.post('/withdraw', wrap(async (req, res) => res.status(201).json(await panel.requestWithdrawal(req.agency.id, req.body || {}))));
router.post('/withdraw/:id/cancel', wrap(async (req, res) => res.json(await panel.cancelWithdrawal(req.agency.id, req.params.id))));

module.exports = router;

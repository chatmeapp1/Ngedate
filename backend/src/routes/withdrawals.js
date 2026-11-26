const express = require('express');
const rateLimit = require('express-rate-limit');
const withdraw = require('../services/withdraw');
const { wrap } = require('../lib/errors');
const { pushBalances } = require('./conversations');

const router = express.Router();

// Batasi percobaan (mis. menebak password saat mengubah rekening)
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

// Info untuk layar Tarik diamond: saldo, kurs, minimum, rekening, pengajuan yang berjalan
router.get('/options', wrap(async (req, res) => {
  res.json(await withdraw.options(req.user.id));
}));

router.put('/account', wrap(async (req, res) => {
  res.json({ ok: true, ...(await withdraw.saveAccount(req.user.id, req.body || {})) });
}));

router.get('/', wrap(async (req, res) => {
  res.json(await withdraw.listMine(req.user.id));
}));

router.post('/', wrap(async (req, res) => {
  const w = await withdraw.request(req.user.id, req.body || {});
  await pushBalances([req.user.id]);
  res.status(201).json(w);
}));

router.post('/:id/cancel', wrap(async (req, res) => {
  const w = await withdraw.cancel(req.user.id, req.params.id);
  await pushBalances([req.user.id]);
  res.json(w);
}));

module.exports = router;

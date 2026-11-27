const express = require('express');
const db = require('../db');
const checkin = require('../services/checkin');
const wallet = require('../services/wallet');
const realtime = require('../realtime');
const { wrap } = require('../lib/errors');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  res.json(await checkin.status(db, req.user.id));
}));

router.post('/claim', wrap(async (req, res) => {
  const r = await checkin.claim(req.user.id, req.user.role);
  const b = await wallet.balances(db, req.user.id);
  if (b) realtime.emitTo(req.user.id, 'wallet:update', b);
  res.json(r);
}));

module.exports = router;

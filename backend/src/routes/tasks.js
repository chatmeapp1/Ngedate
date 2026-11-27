const express = require('express');
const db = require('../db');
const tasks = require('../services/tasks');
const wallet = require('../services/wallet');
const realtime = require('../realtime');
const { wrap } = require('../lib/errors');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  res.json(await tasks.list(db, req.user.id));
}));

router.post('/:key/claim', wrap(async (req, res) => {
  const r = await tasks.claim(req.user.id, String(req.params.key));
  const b = await wallet.balances(db, req.user.id);
  if (b) realtime.emitTo(req.user.id, 'wallet:update', b);
  res.json({ ...r, ...(await tasks.list(db, req.user.id)) });
}));

module.exports = router;

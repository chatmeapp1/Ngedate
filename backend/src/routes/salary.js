const express = require('express');
const db = require('../db');
const salary = require('../services/salary');
const { wrap } = require('../lib/errors');

const router = express.Router();

// Status gaji pokok host (enrolled=false jika tidak ikut program). Sekalian memeriksa pembayaran otomatis.
router.get('/', wrap(async (req, res) => {
  await salary.evaluate(req.user.id);
  res.json(await salary.status(db, req.user.id));
}));

module.exports = router;

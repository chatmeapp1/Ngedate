const express = require('express');
const translate = require('../services/translate');
const { wrap } = require('../lib/errors');

const router = express.Router();

// { text, to } -> { text, from, same }
router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  res.json(await translate.translate(req.user.id, b.text, b.to));
}));

module.exports = router;

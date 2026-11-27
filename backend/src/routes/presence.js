const express = require('express');
const realtime = require('../realtime');
const { wrap, badRequest } = require('../lib/errors');

/**
 * Status online terbaru untuk daftar yang sedang tampil di layar.
 * GET /api/presence?ids=1,2,3 (maks 100)  ->  { "1": true, "2": false }
 * Online = punya koneksi realtime aktif (app sedang dibuka).
 */
const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((x) => Number(x))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) return res.json({});
  if (ids.length > 100) throw badRequest('Maksimal 100 ID');
  res.json(Object.fromEntries(ids.map((id) => [id, realtime.isPresent(id)])));
}));

module.exports = router;

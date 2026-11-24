const express = require('express');
const db = require('../db');
const { wrap } = require('../lib/errors');

const router = express.Router();

function mapGift(g) {
  return {
    id: g.id,
    name: g.name,
    price: Number(g.price),
    imageUrl: g.image_url,
    animationUrl: g.animation_url,
    soundUrl: g.sound_url,
    category: g.category,
    sortOrder: g.sort_order,
    active: g.active,
  };
}

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM gifts WHERE active ORDER BY sort_order, price`);
  res.json(rows.map(mapGift));
}));

module.exports = router;
module.exports.mapGift = mapGift;

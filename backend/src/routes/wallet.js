const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap } = require('../lib/errors');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT coins, diamonds FROM users WHERE id = $1`, [req.user.id]);
  const { rows: held } = await db.query(
    `SELECT COALESCE(SUM(m.price), 0) AS held FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = $1 AND m.payment_status = 'held'`,
    [req.user.id]
  );
  res.json({
    coins: Number(rows[0].coins),
    diamonds: Number(rows[0].diamonds),
    heldCoins: Number(held[0].held), // koin yang sedang ditahan menunggu balasan host
  });
}));

// Riwayat transaksi (koin & diamond), terbaru di atas
router.get('/ledger', wrap(async (req, res) => {
  const params = [req.user.id];
  let cursor = '';
  if (req.query.before) {
    params.push(v.id(req.query.before, 'before'));
    cursor = 'AND id < $2';
  }
  const { rows } = await db.query(
    `SELECT * FROM ledger WHERE user_id = $1 ${cursor} ORDER BY id DESC LIMIT 50`,
    params
  );
  res.json(rows.map((r) => ({
    id: Number(r.id),
    currency: r.currency,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    reason: r.reason,
    refType: r.ref_type,
    refId: r.ref_id === null ? null : Number(r.ref_id),
    note: r.note,
    createdAt: r.created_at,
  })));
}));

module.exports = router;

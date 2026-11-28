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

// Kelompok alasan transaksi untuk tab di "Detail penagihan"
const KINDS = {
  spend: ['chat_hold', 'gift_send', 'media_unlock'],
  topup: ['admin_topup', 'topup'],
  reward: ['checkin', 'task_reward', 'salary_reward'],
  refund: ['chat_refund'],
};

// Riwayat transaksi (koin & diamond), terbaru di atas.
//   before    id terakhir halaman sebelumnya
//   currency  coin | diamond
//   month     YYYY-MM (bulan WIB)
//   kind      spend | topup | reward | refund
router.get('/ledger', wrap(async (req, res) => {
  const params = [req.user.id];
  const where = ['user_id = $1'];
  if (req.query.before) {
    params.push(v.id(req.query.before, 'before'));
    where.push(`id < $${params.length}`);
  }
  if (req.query.currency) {
    params.push(v.str(req.query.currency, 'currency', { pattern: /^(coin|diamond)$/ }));
    where.push(`currency = $${params.length}`);
  }
  if (req.query.month) {
    params.push(v.str(req.query.month, 'month', { pattern: /^\d{4}-(0[1-9]|1[0-2])$/ }) + '-01');
    const n = params.length;
    where.push(`(created_at AT TIME ZONE 'Asia/Jakarta') >= $${n}::date AND (created_at AT TIME ZONE 'Asia/Jakarta') < ($${n}::date + interval '1 month')`);
  }
  if (req.query.kind) {
    const kind = v.str(req.query.kind, 'kind', { pattern: /^(spend|topup|reward|refund)$/ });
    params.push(KINDS[kind]);
    where.push(`reason = ANY($${params.length}::text[])`);
  }
  const { rows } = await db.query(
    `SELECT * FROM ledger WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 50`,
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

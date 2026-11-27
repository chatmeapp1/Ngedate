const express = require('express');
const db = require('../db');
const { wrap } = require('../lib/errors');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, type, title, body, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 60`,
    [req.user.id]
  );
  res.json(rows.map((r) => ({ id: Number(r.id), type: r.type, title: r.title, body: r.body, read: !!r.read_at, createdAt: r.created_at })));
}));

router.get('/unread-count', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
  res.json({ total: rows[0].n });
}));

router.post('/read', wrap(async (req, res) => {
  await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;

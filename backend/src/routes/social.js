const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap, badRequest, notFound } = require('../lib/errors');

const router = express.Router();

async function target(id) {
  const { rows } = await db.query(`SELECT id, role FROM users WHERE id = $1 AND status = 'active'`, [id]);
  if (!rows.length) throw notFound('Pengguna tidak ditemukan');
  return rows[0];
}

async function counts(id) {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = $1)::int AS followers,
            (SELECT COUNT(*) FROM likes WHERE target_id = $1)::int AS likes`,
    [id]
  );
  return rows[0];
}

router.post('/:id/follow', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  if (id === req.user.id) throw badRequest('Tidak bisa mengikuti diri sendiri');
  await target(id);
  await db.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
  res.json({ isFollowing: true, ...(await counts(id)) });
}));

router.delete('/:id/follow', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  await db.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [req.user.id, id]);
  res.json({ isFollowing: false, ...(await counts(id)) });
}));

router.post('/:id/like', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  if (id === req.user.id) throw badRequest('Tidak bisa menyukai diri sendiri');
  const t = await target(id);
  if (t.role !== 'host') throw badRequest('Hanya host yang bisa disukai');
  await db.query(`INSERT INTO likes (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
  res.json({ isLiked: true, ...(await counts(id)) });
}));

router.delete('/:id/like', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  await db.query(`DELETE FROM likes WHERE user_id = $1 AND target_id = $2`, [req.user.id, id]);
  res.json({ isLiked: false, ...(await counts(id)) });
}));

module.exports = router;

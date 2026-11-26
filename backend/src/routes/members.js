const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const realtime = require('../realtime');
const { wrap, notFound } = require('../lib/errors');
const { publicUser } = require('./serializers');
const safety = require('../services/safety');

const router = express.Router();
const PAGE_SIZE = 30;

// Pengguna pria yang sudah melengkapi profil (yang dilihat host di Beranda)
const MEMBER_WHERE = `u.role = 'user' AND u.gender = 'male' AND u.status = 'active' AND u.profile_completed`;

/**
 * Daftar pengguna pria, khusus akun host.
 *   q        cari nama / username / ID
 *   country  kode negara
 *   tab      all | new | online
 *   page     mulai dari 1
 */
router.get('/', wrap(async (req, res) => {
  const page = v.int(req.query.page ?? 1, 'page', { min: 1, max: 1000 });
  const q = v.str(req.query.q, 'q', { max: 50, optional: true });
  const country = v.str(req.query.country, 'country', { optional: true, pattern: /^[A-Za-z]{2}$/ });
  const tab = v.str(req.query.tab ?? 'all', 'tab', { pattern: /^(all|new|online)$/ });

  const params = [realtime.onlineUserIds()];
  const where = [MEMBER_WHERE];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    const idMatch = /^\d+$/.test(q) ? ` OR u.id = ${Number(q)}` : '';
    where.push(`(lower(u.display_name) LIKE $${i} OR u.username LIKE $${i}${idMatch})`);
  }
  if (country) {
    params.push(country.toUpperCase());
    where.push(`u.country_code = $${params.length}`);
  }
  if (tab === 'online') where.push(`u.id = ANY($1::bigint[])`);
  params.push(req.user.id);
  where.push(safety.notBlockedSql('u', params.length));
  const order =
    tab === 'new'
      ? `u.created_at DESC, u.id DESC`
      : `(u.id = ANY($1::bigint[])) DESC, u.last_seen_at DESC NULLS LAST, u.id DESC`;

  params.push((page - 1) * PAGE_SIZE);
  const { rows } = await db.query(
    `SELECT u.* FROM users u WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET $${params.length}`,
    params
  );
  res.json(rows.map((u) => publicUser(u)));
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT u.* FROM users u WHERE ${MEMBER_WHERE} AND u.id = $1`, [v.id(req.params.id)]);
  if (!rows.length) throw notFound('Pengguna tidak ditemukan');
  if ((await safety.blockerBetween(db, req.user.id, rows[0].id)) !== null) throw notFound('Pengguna tidak ditemukan');
  res.json(publicUser(rows[0]));
}));

module.exports = router;

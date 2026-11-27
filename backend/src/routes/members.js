const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const realtime = require('../realtime');
const { wrap, notFound } = require('../lib/errors');
const { publicUser } = require('./serializers');
const safety = require('../services/safety');
const { getSettings } = require('../services/settings');
const { levelOf, vipOf } = require('../services/membership');

const router = express.Router();
const PAGE_SIZE = 30;

// Level (dari total top up) dan VIP, ditampilkan kepada host di kartu/profil pengguna
const withBadges = (u, s) => ({
  ...publicUser(u),
  level: levelOf(Number(u.topup_total || 0), s.level_thresholds),
  vip: vipOf(Number(u.topup_total || 0), s.vip_thresholds),
  // bingkai avatar hadiah check-in yang masih aktif (0 = tidak ada)
  checkinFrame: u.checkin_frame_until && new Date(u.checkin_frame_until) > new Date() ? Number(u.checkin_frame) : 0,
});

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

  const params = [realtime.presentUserIds()];
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
  const settings = await getSettings();
  res.json(rows.map((u) => withBadges(u, settings)));
}));

/**
 * "Orang asing": pengguna yang melihat profil host ini tetapi belum punya percakapan dengannya,
 * terbaru dulu. Tiap item membawa waktu terakhir melihat dan jumlah kunjungan.
 */
router.get('/visitors', wrap(async (req, res) => {
  const page = v.int(req.query.page ?? 1, 'page', { min: 1, max: 1000 });
  const params = [req.user.id, (page - 1) * PAGE_SIZE];
  const { rows } = await db.query(
    `SELECT u.*, pv.views, pv.last_at AS viewed_at
     FROM profile_views pv JOIN users u ON u.id = pv.viewer_id
     WHERE pv.host_id = $1 AND u.role = 'user' AND u.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.host_id = $1 AND c.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
     ORDER BY pv.last_at DESC LIMIT ${PAGE_SIZE} OFFSET $2`,
    params
  );
  const settings = await getSettings();
  res.json(rows.map((u) => ({ ...withBadges(u, settings), views: u.views, viewedAt: u.viewed_at })));
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT u.* FROM users u WHERE ${MEMBER_WHERE} AND u.id = $1`, [v.id(req.params.id)]);
  if (!rows.length) throw notFound('Pengguna tidak ditemukan');
  if ((await safety.blockerBetween(db, req.user.id, rows[0].id)) !== null) throw notFound('Pengguna tidak ditemukan');
  const id = Number(rows[0].id);
  const { rows: st } = await db.query(
    `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = $2)::int AS followers,
            (SELECT COUNT(*) FROM follows WHERE follower_id = $2)::int AS following,
            (SELECT COUNT(*) FROM likes WHERE target_id = $2)::int AS likes,
            EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS is_following,
            EXISTS (SELECT 1 FROM likes WHERE user_id = $1 AND target_id = $2) AS is_liked`,
    [req.user.id, id]
  );
  res.json({ ...withBadges(rows[0], await getSettings()), followers: st[0].followers, following: st[0].following, likes: st[0].likes, isFollowing: st[0].is_following, isLiked: st[0].is_liked });
}));

module.exports = router;

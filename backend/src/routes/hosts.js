const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const realtime = require('../realtime');
const { wrap, notFound } = require('../lib/errors');
const { hostCard, publicUser } = require('./serializers');
const { REGIONS, REGION_KEYS } = require('../lib/regions');
const safety = require('../services/safety');
const { getSettings } = require('../services/settings');

const router = express.Router();
const PAGE_SIZE = 30;

const HOST_COLUMNS = `u.*, hp.chat_price, hp.wa_enabled, hp.wa_number, hp.wa_unlock_threshold`;
const HOST_FROM = `FROM users u LEFT JOIN host_profiles hp ON hp.user_id = u.id
                   WHERE u.role = 'host' AND u.status = 'active' AND u.host_status = 'approved'
                   AND u.gender IS DISTINCT FROM 'male'`;

/**
 * Daftar host.
 *   q        cari nama / username / ID
 *   country  kode negara (ID, PH, VN, ...)
 *   region   asia | arab | india | latino | afrika | barat
 *   tab      all | popular | new | online
 *   page     mulai dari 1
 */
router.get('/', wrap(async (req, res) => {
  const page = v.int(req.query.page ?? 1, 'page', { min: 1, max: 1000 });
  const q = v.str(req.query.q, 'q', { max: 50, optional: true });
  const country = v.str(req.query.country, 'country', { optional: true, pattern: /^[A-Za-z]{2}$/ });
  const tab = v.str(req.query.tab ?? 'all', 'tab', { pattern: /^(all|popular|new|online)$/ });
  const region = v.str(req.query.region, 'region', {
    optional: true,
    pattern: new RegExp(`^(${REGION_KEYS.join('|')})$`),
  });

  const online = realtime.onlineUserIds();
  const params = [online];
  const where = [];
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
  if (region) {
    params.push(REGIONS[region]);
    where.push(`u.country_code = ANY($${params.length}::char(2)[])`);
  }
  if (tab === 'online') where.push(`u.id = ANY($1::bigint[])`);
  params.push(req.user.id);
  where.push(safety.notBlockedSql('u', params.length));

  let order = `(u.id = ANY($1::bigint[])) DESC, u.last_seen_at DESC NULLS LAST, u.id DESC`;
  let popularJoin = '';
  if (tab === 'new') order = `u.created_at DESC, u.id DESC`;
  if (tab === 'popular') {
    // Host dengan nilai gift terbesar 30 hari terakhir
    popularJoin = `LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(m.price), 0) AS score FROM conversations c
        JOIN messages m ON m.conversation_id = c.id AND m.type = 'gift'
        WHERE c.host_id = u.id AND m.created_at > now() - interval '30 days'
      ) pop ON true`;
    order = `pop.score DESC, (u.id = ANY($1::bigint[])) DESC, u.id DESC`;
  }

  params.push((page - 1) * PAGE_SIZE);
  const sql = `SELECT ${HOST_COLUMNS}
    FROM users u LEFT JOIN host_profiles hp ON hp.user_id = u.id ${popularJoin}
    WHERE u.role = 'host' AND u.status = 'active' AND u.host_status = 'approved' AND u.gender IS DISTINCT FROM 'male' ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ORDER BY ${order}
    LIMIT ${PAGE_SIZE} OFFSET $${params.length}`;
  const { rows } = await db.query(sql, params);
  const { host_level_thresholds: th } = await getSettings();
  res.json(rows.map((r) => hostCard(r, th)));
}));

// Jumlah host per negara (untuk kartu negara di beranda)
router.get('/countries', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.country_code AS code, COUNT(*)::int AS count ${HOST_FROM} AND u.country_code IS NOT NULL
     GROUP BY u.country_code ORDER BY count DESC, code`
  );
  res.json(rows.map((r) => ({ code: r.code.trim(), count: r.count })));
}));

// Kartu wilayah di Beranda: selalu 6 wilayah, beserta jumlah host & foto host teratas
router.get('/regions', wrap(async (req, res) => {
  const result = [];
  for (const key of REGION_KEYS) {
    const { rows } = await db.query(
      `SELECT COUNT(*) OVER ()::int AS total, u.avatar_url
       FROM users u
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(m.price), 0) AS score FROM conversations c
         JOIN messages m ON m.conversation_id = c.id AND m.type = 'gift'
         WHERE c.host_id = u.id AND m.created_at > now() - interval '30 days'
       ) pop ON true
       WHERE u.role = 'host' AND u.status = 'active' AND u.host_status = 'approved' AND u.gender IS DISTINCT FROM 'male'
         AND u.country_code = ANY($1::char(2)[])
       ORDER BY (u.avatar_url IS NOT NULL) DESC, pop.score DESC, u.last_seen_at DESC NULLS LAST, u.id
       LIMIT 1`,
      [REGIONS[key]]
    );
    result.push({ key, count: rows[0] ? rows[0].total : 0, coverUrl: rows[0] ? rows[0].avatar_url : null });
  }
  res.json(result);
}));

// Profil host lengkap
router.get('/:id', wrap(async (req, res) => {
  const hostId = v.id(req.params.id);
  const viewer = req.user.id;
  const { rows } = await db.query(`SELECT ${HOST_COLUMNS} ${HOST_FROM} AND u.id = $1`, [hostId]);
  if (!rows.length) throw notFound('Host tidak ditemukan');
  if ((await safety.blockerBetween(db, viewer, hostId)) !== null) throw notFound('Host tidak ditemukan');

  const [stats, photos, reply, conv] = await Promise.all([
    db.query(
      `SELECT
         (SELECT COUNT(*) FROM follows WHERE followee_id = $1)::int AS followers,
         (SELECT COUNT(*) FROM follows WHERE follower_id = $1)::int AS following,
         (SELECT COUNT(*) FROM likes WHERE target_id = $1)::int AS likes,
         EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS is_following,
         EXISTS (SELECT 1 FROM likes WHERE user_id = $2 AND target_id = $1) AS is_liked`,
      [hostId, viewer]
    ),
    db.query(`SELECT id, url FROM user_photos WHERE user_id = $1 AND status = 'approved' ORDER BY sort_order, id`, [hostId]),
    db.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (m.settled_at - m.created_at))) / 60 AS minutes, COUNT(*)::int AS n
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.host_id = $1 AND m.type = 'text' AND m.payment_status = 'paid'
         AND m.settled_at > now() - interval '30 days'`,
      [hostId]
    ),
    db.query(`SELECT id, gift_total, wa_unlocked_at FROM conversations WHERE user_id = $1 AND host_id = $2`, [viewer, hostId]),
  ]);

  const s = stats.rows[0];
  const c = conv.rows[0];
  res.json({
    ...hostCard(rows[0], (await getSettings()).host_level_thresholds),
    followers: s.followers,
    following: s.following,
    likes: s.likes,
    isFollowing: s.is_following,
    isLiked: s.is_liked,
    photos: photos.rows.map((p) => ({ id: Number(p.id), url: p.url })),
    // null jika belum cukup data
    avgReplyMinutes: reply.rows[0].n >= 3 ? Math.max(1, Math.round(Number(reply.rows[0].minutes))) : null,
    conversation: c
      ? { id: Number(c.id), giftTotal: Number(c.gift_total), waUnlocked: !!c.wa_unlocked_at }
      : null,
  });
}));

// Dinding hadiah: gift yang diterima + pengirim terbesar
router.get('/:id/gifts', wrap(async (req, res) => {
  const hostId = v.id(req.params.id);
  const [gifts, senders] = await Promise.all([
    db.query(
      `SELECT g.id, g.name, g.icon, g.image_url, g.price, SUM(m.gift_count)::int AS count
       FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN gifts g ON g.id = m.gift_id
       WHERE c.host_id = $1 AND m.type = 'gift'
       GROUP BY g.id ORDER BY g.price DESC`,
      [hostId]
    ),
    db.query(
      `SELECT u.*, SUM(m.price)::bigint AS total
       FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = c.user_id
       WHERE c.host_id = $1 AND m.type = 'gift'
       GROUP BY u.id ORDER BY total DESC LIMIT 10`,
      [hostId]
    ),
  ]);
  res.json({
    gifts: gifts.rows.map((g) => ({ id: g.id, name: g.name, icon: g.icon, imageUrl: g.image_url, price: Number(g.price), count: g.count })),
    topSenders: senders.rows.map((u) => ({ user: publicUser(u), total: Number(u.total) })),
  });
}));

module.exports = router;

const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const storage = require('../lib/storage');
const { containsContact } = require('../lib/contactFilter');
const safety = require('../services/safety');
const { getSettings } = require('../services/settings');
const { levelOf } = require('../services/membership');
const { wrap, notFound, badRequest, forbidden } = require('../lib/errors');

/**
 * Momen: host memposting foto + teks; semua pengguna bisa melihat, menyukai, dan berkomentar.
 * Hanya host (disetujui) yang boleh memposting.
 */
const router = express.Router();
const PAGE = 20;

const mapMoment = (r) => ({
  id: Number(r.id),
  body: r.body,
  imageUrl: r.image_url,
  views: Number(r.views),
  likes: Number(r.likes),
  comments: Number(r.comments),
  liked: !!r.liked,
  createdAt: r.created_at,
  host: {
    id: Number(r.host_id),
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    verified: !!r.verified,
  },
});

const SELECT = `SELECT m.id, m.host_id, m.body, m.image_url, m.views, m.created_at,
    u.display_name, u.avatar_url, u.verified,
    (SELECT COUNT(*) FROM moment_likes l WHERE l.moment_id = m.id) AS likes,
    (SELECT COUNT(*) FROM moment_comments c WHERE c.moment_id = m.id) AS comments,
    EXISTS (SELECT 1 FROM moment_likes l WHERE l.moment_id = m.id AND l.user_id = $1) AS liked
  FROM moments m JOIN users u ON u.id = m.host_id`;

// ?tab=popular|new|mine & offset
router.get('/', wrap(async (req, res) => {
  const tab = ['popular', 'new', 'mine'].includes(req.query.tab) ? req.query.tab : 'popular';
  const offset = v.int(req.query.offset, 'offset', { min: 0, max: 5000, optional: true }) || 0;
  const where = [`u.status = 'active'`, safety.notBlockedSql('u', 1)];
  if (tab === 'mine') where.push(`m.host_id = $1`);
  const order = tab === 'popular' ? 'm.views DESC, m.id DESC' : 'm.id DESC';
  const { rows } = await db.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${offset}`, [req.user.id]);
  res.json({ items: rows.map(mapMoment), hasMore: rows.length === PAGE });
}));

// Posting baru (host): foto (opsional) dan/atau teks
router.post('/', storage.single, wrap(async (req, res) => {
  if (req.user.role !== 'host') throw forbidden('Hanya host yang bisa memposting momen');
  const body = v.str(req.body.body, 'Teks', { max: 500, optional: true }) || null;
  if (body && containsContact(body)) throw badRequest('Teks tidak boleh berisi nomor, link, atau kontak', 'CONTACT_BLOCKED');
  let url = null;
  if (req.file) url = (await storage.save(req)).url;
  if (!body && !url) throw badRequest('Isi teks atau pilih foto');
  const { rows } = await db.query(`INSERT INTO moments (host_id, body, image_url) VALUES ($1, $2, $3) RETURNING id`, [req.user.id, body, url]);
  const { rows: r } = await db.query(`${SELECT} WHERE m.id = $2`, [req.user.id, rows[0].id]);
  res.status(201).json(mapMoment(r[0]));
}));

async function loadVisible(req, id) {
  const { rows } = await db.query(`${SELECT} WHERE m.id = $2 AND u.status = 'active' AND ${safety.notBlockedSql('u', 1)}`, [req.user.id, id]);
  if (!rows.length) throw notFound('Momen tidak ditemukan');
  return rows[0];
}

// Detail (menambah jumlah dilihat, kecuali oleh pemilik)
router.get('/:id', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  const row = await loadVisible(req, id);
  if (Number(row.host_id) !== req.user.id) {
    await db.query(`UPDATE moments SET views = views + 1 WHERE id = $1`, [id]);
    row.views = Number(row.views) + 1;
  }
  res.json(mapMoment(row));
}));

router.delete('/:id', wrap(async (req, res) => {
  const { rows } = await db.query(`DELETE FROM moments WHERE id = $1 AND host_id = $2 RETURNING image_url`, [v.id(req.params.id), req.user.id]);
  if (rows.length && rows[0].image_url) await storage.remove(rows[0].image_url);
  res.json({ ok: true });
}));

// Suka / batal suka
router.post('/:id/like', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  await loadVisible(req, id);
  const del = await db.query(`DELETE FROM moment_likes WHERE moment_id = $1 AND user_id = $2`, [id, req.user.id]);
  if (!del.rowCount) await db.query(`INSERT INTO moment_likes (moment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, req.user.id]);
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM moment_likes WHERE moment_id = $1`, [id]);
  res.json({ liked: !del.rowCount, likes: rows[0].n });
}));

// Komentar
router.get('/:id/comments', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  await loadVisible(req, id);
  const s = await getSettings(db);
  const { rows } = await db.query(
    `SELECT c.id, c.body, c.created_at, u.id AS user_id, u.display_name, u.avatar_url, u.role, u.verified, u.topup_total
     FROM moment_comments c JOIN users u ON u.id = c.user_id
     WHERE c.moment_id = $1 AND ${safety.notBlockedSql('u', 2)} ORDER BY c.id DESC LIMIT 100`,
    [id, req.user.id]
  );
  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      body: r.body,
      createdAt: r.created_at,
      user: {
        id: Number(r.user_id),
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        verified: !!r.verified,
        role: r.role,
        level: r.role === 'host' ? null : levelOf(Number(r.topup_total), s.level_thresholds),
      },
    }))
  );
}));

router.post('/:id/comments', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  await loadVisible(req, id);
  const body = v.str(req.body.body, 'Komentar', { min: 1, max: 300 });
  if (containsContact(body)) throw badRequest('Komentar tidak boleh berisi nomor, link, atau kontak', 'CONTACT_BLOCKED');
  const { rows } = await db.query(`INSERT INTO moment_comments (moment_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, created_at`, [id, req.user.id, body]);
  res.status(201).json({ id: Number(rows[0].id), body, createdAt: rows[0].created_at });
}));

module.exports = router;

const express = require('express');
const path = require('path');
const db = require('../db');
const v = require('../lib/validate');
const storage = require('../lib/storage');
const { wrap, notFound, ApiError } = require('../lib/errors');

/**
 * Berkas media privat dari host. Hanya host pengirim dan pengguna di percakapan itu yang bisa membukanya;
 * pengguna harus membuka (membayar) dulu jika host memasang harga. Mendukung Range supaya video bisa di-seek.
 */
const router = express.Router();

router.get('/:id', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  const { rows } = await db.query(
    `SELECT m.media_file, m.media_price, c.user_id AS conv_user, c.host_id AS conv_host, mu.user_id AS unlocked_by
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN media_unlocks mu ON mu.message_id = m.id
     WHERE m.id = $1 AND m.media_private AND m.media_file IS NOT NULL`,
    [id]
  );
  const m = rows[0];
  const me = req.user.id;
  if (!m || (me !== Number(m.conv_host) && me !== Number(m.conv_user))) throw notFound('Media tidak ditemukan');
  if (me === Number(m.conv_user) && Number(m.media_price) > 0 && !m.unlocked_by) {
    throw new ApiError(402, 'MEDIA_LOCKED', 'Buka dulu dengan koin untuk melihat media ini');
  }
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(storage.PRIVATE_DIR, path.basename(m.media_file)), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File tidak ditemukan' } });
  });
}));

module.exports = router;

const fs = require('fs');
const path = require('path');
const db = require('../db');
const storage = require('../lib/storage');
const realtime = require('../realtime');
const { notify } = require('./notifications');
const { badRequest, notFound } = require('../lib/errors');

/**
 * Moderasi foto/video privat host oleh admin SETELAH terkirim: media langsung sampai ke pengguna (tanpa menunggu),
 * admin bisa melihat daftar media terbaru dan menghapus yang melanggar. Menghapus membuang file dari server,
 * menyembunyikan pesan dari pengguna, dan memberi tahu host. Koin yang sudah dibayar pengguna tidak dikembalikan otomatis.
 */
const SELECT = `SELECT m.id, m.type, m.media_price, m.media_file, m.review_status, m.review_reason, m.created_at, m.reviewed_at,
    m.conversation_id, c.host_id, c.user_id,
    h.display_name AS host_name, h.username AS host_username, u.display_name AS user_name,
    EXISTS (SELECT 1 FROM media_unlocks mu WHERE mu.message_id = m.id) AS unlocked
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  JOIN users h ON h.id = c.host_id
  JOIN users u ON u.id = c.user_id
  WHERE m.media_private`;

const map = (r) => ({
  id: Number(r.id),
  type: r.type,
  price: Number(r.media_price),
  status: r.review_status,
  reason: r.review_reason,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
  hasFile: !!r.media_file,
  unlocked: !!r.unlocked,
  conversationId: Number(r.conversation_id),
  host: { id: Number(r.host_id), displayName: r.host_name, username: r.host_username },
  userName: r.user_name,
});

async function list(status) {
  const st = status === 'rejected' ? 'rejected' : 'approved';
  const { rows } = await db.query(`${SELECT} AND m.review_status = $1 ORDER BY m.id DESC LIMIT 100`, [st]);
  return rows.map(map);
}

/** Path file untuk admin yang meninjau (null jika sudah dihapus). */
async function filePath(idRaw) {
  const id = Number(idRaw);
  const { rows } = await db.query(`SELECT media_file, type FROM messages WHERE id = $1 AND media_private`, [id]);
  if (!rows.length || !rows[0].media_file) throw notFound('File tidak ditemukan');
  return { file: path.join(storage.PRIVATE_DIR, path.basename(rows[0].media_file)), type: rows[0].type };
}

async function reject(idRaw, reasonRaw) {
  const id = Number(idRaw);
  const reason = String(reasonRaw ?? '').trim() || 'Dihapus admin';
  if (reason.length > 200) throw badRequest('Alasan maksimal 200 karakter');
  const r = await db.query(
    `UPDATE messages m SET review_status = 'rejected', review_reason = $2, reviewed_at = now(), media_file = NULL
     FROM (SELECT id, media_file FROM messages WHERE id = $1) o
     WHERE m.id = o.id AND m.media_private AND m.review_status IN ('pending', 'approved')
     RETURNING o.media_file AS old_file, m.conversation_id, m.type`,
    [id, reason]
  );
  if (!r.rows.length) throw notFound('Media tidak ditemukan atau sudah ditolak');
  const row = r.rows[0];
  if (row.old_file) await fs.promises.unlink(path.join(storage.PRIVATE_DIR, path.basename(row.old_file))).catch(() => {});
  const { rows: c } = await db.query(`SELECT user_id, host_id FROM conversations WHERE id = $1`, [row.conversation_id]);
  const evt = { conversationId: Number(row.conversation_id), messageId: id, status: 'rejected', reason };
  realtime.emitTo([Number(c[0].host_id), Number(c[0].user_id)], 'media:review', evt);
  await notify(Number(c[0].host_id), 'media', row.type === 'image' ? 'Foto privat dihapus admin' : 'Video privat dihapus admin', `Alasan: ${reason}`);
}

module.exports = { list, filePath, reject };

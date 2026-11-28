const fs = require('fs');
const path = require('path');
const db = require('../db');
const chat = require('./chat');
const storage = require('../lib/storage');
const realtime = require('../realtime');
const { notify } = require('./notifications');
const { badRequest, notFound } = require('../lib/errors');

/**
 * Review foto/video privat host oleh admin. Media baru berstatus 'pending': hanya host pengirim yang melihatnya.
 *   approve  -> tampil ke pengguna (pesan baru + belum dibaca), host diberi tahu
 *   reject   -> file dihapus dari server; pesan tidak pernah/tidak lagi tampil ke pengguna
 * "Hapus" untuk media yang sudah disetujui = reject. Koin yang sudah dibayar pengguna tidak dikembalikan otomatis.
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
  const st = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
  const { rows } = await db.query(`${SELECT} AND m.review_status = $1 ORDER BY m.id ${st === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`, [st]);
  return rows.map(map);
}

/** Path file untuk admin yang meninjau (null jika sudah dihapus). */
async function filePath(idRaw) {
  const id = Number(idRaw);
  const { rows } = await db.query(`SELECT media_file, type FROM messages WHERE id = $1 AND media_private`, [id]);
  if (!rows.length || !rows[0].media_file) throw notFound('File tidak ditemukan');
  return { file: path.join(storage.PRIVATE_DIR, path.basename(rows[0].media_file)), type: rows[0].type };
}

async function approve(idRaw) {
  const id = Number(idRaw);
  const r = await db.tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE messages SET review_status = 'approved', review_reason = NULL, reviewed_at = now()
       WHERE id = $1 AND media_private AND review_status = 'pending' RETURNING conversation_id, type`,
      [id]
    );
    if (!rows.length) throw notFound('Media tidak ditemukan atau sudah diproses');
    // Baru sekarang pengguna menerima pesan ini (belum dibaca + pratinjau terakhir)
    await client.query(
      `UPDATE conversations SET last_message_at = now(), last_message_preview = $2, user_unread = user_unread + 1 WHERE id = $1`,
      [rows[0].conversation_id, rows[0].type === 'image' ? '🔒 Foto privat' : '🔒 Video privat']
    );
    const { rows: c } = await client.query(`SELECT user_id, host_id FROM conversations WHERE id = $1`, [rows[0].conversation_id]);
    return { conversationId: Number(rows[0].conversation_id), userId: Number(c[0].user_id), hostId: Number(c[0].host_id), type: rows[0].type };
  });
  const message = await chat.fetchMessage(db, id);
  for (const uid of [r.userId, r.hostId]) {
    const conversation = await chat.getConversation(uid, r.conversationId).catch(() => null);
    if (conversation) realtime.emitTo(uid, 'message:new', { conversationId: r.conversationId, message, conversation });
  }
  realtime.emitTo(r.hostId, 'media:review', { conversationId: r.conversationId, messageId: id, status: 'approved', reason: null });
  await notify(r.hostId, 'media', r.type === 'image' ? 'Foto privat disetujui' : 'Video privat disetujui', 'Media privatmu sudah disetujui dan terkirim ke pengguna.');
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
  await notify(Number(c[0].host_id), 'media', row.type === 'image' ? 'Foto privat ditolak' : 'Video privat ditolak', `Alasan: ${reason}`);
}

module.exports = { list, filePath, approve, reject };

const db = require('../db');
const v = require('../lib/validate');
const wallet = require('./wallet');
const { ApiError, badRequest, notFound, forbidden } = require('../lib/errors');

/** Alasan laporan yang diterima (kode -> label untuk admin). */
const REPORT_REASONS = {
  spam: 'Spam / promosi',
  harassment: 'Kasar / pelecehan',
  scam: 'Penipuan / minta uang',
  sexual: 'Konten tidak pantas',
  underage: 'Diduga di bawah umur',
  other: 'Lainnya',
};
const DAILY_REPORT_LIMIT = 10;
const EVIDENCE_MESSAGES = 15;

/**
 * Potongan SQL: baris users `alias` tidak punya blokir (ke arah mana pun) dengan
 * pengguna yang parameternya ada di $viewerParam.
 */
function notBlockedSql(alias, viewerParam) {
  return `NOT EXISTS (SELECT 1 FROM blocks bl
    WHERE (bl.blocker_id = $${viewerParam} AND bl.blocked_id = ${alias}.id)
       OR (bl.blocker_id = ${alias}.id AND bl.blocked_id = $${viewerParam}))`;
}

/** Mengembalikan id pemblokir jika ada blokir antara a dan b, selain itu null. */
async function blockerBetween(client, a, b) {
  const { rows } = await client.query(
    `SELECT blocker_id FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
    [a, b]
  );
  return rows.length ? Number(rows[0].blocker_id) : null;
}

/** Lempar 403 BLOCKED bila ada blokir. Pesan sengaja tidak membuka siapa yang memblokir ke pihak yang diblokir. */
async function assertNotBlocked(client, senderId, otherId) {
  const { rows: st } = await client.query(`SELECT status FROM users WHERE id = $1`, [otherId]);
  if (st.length && st[0].status === 'deleted') throw new ApiError(403, 'ACCOUNT_DELETED', 'Akun ini sudah dihapus.');
  const blocker = await blockerBetween(client, senderId, otherId);
  if (blocker === null) return;
  if (blocker === senderId) {
    throw new ApiError(403, 'BLOCKED', 'Kamu memblokir pengguna ini. Buka blokirnya dulu untuk mengirim pesan.');
  }
  throw new ApiError(403, 'BLOCKED', 'Pesan tidak bisa dikirim ke pengguna ini.');
}

// ---------------------------------------------------------------------------
// Blokir
// ---------------------------------------------------------------------------

/**
 * Blokir pengguna. Koin yang masih ditahan di percakapan mereka langsung dikembalikan ke user.
 * Hasil: { refund: { conversationId, userId, hostId, amount, messageIds } | null }
 */
async function blockUser(blockerId, targetIdRaw) {
  const targetId = v.id(targetIdRaw, 'userId');
  if (targetId === blockerId) throw badRequest('Tidak bisa memblokir diri sendiri');

  return db.tx(async (client) => {
    const { rows } = await client.query(`SELECT id, role FROM users WHERE id = $1`, [targetId]);
    if (!rows.length) throw notFound('Pengguna tidak ditemukan');
    if (rows[0].role === 'admin') throw forbidden('Akun ini tidak bisa diblokir');

    await client.query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [blockerId, targetId]
    );

    // Kembalikan koin yang masih ditahan di percakapan mereka
    const { rows: convs } = await client.query(
      `SELECT * FROM conversations
       WHERE (user_id = $1 AND host_id = $2) OR (user_id = $2 AND host_id = $1) FOR UPDATE`,
      [blockerId, targetId]
    );
    let refund = null;
    for (const c of convs) {
      const { rows: held } = await client.query(
        `UPDATE messages SET payment_status = 'refunded', settled_at = now()
         WHERE conversation_id = $1 AND payment_status = 'held' RETURNING id, price`,
        [c.id]
      );
      if (!held.length) continue;
      const total = held.reduce((sum, r) => sum + Number(r.price), 0);
      await wallet.creditCoins(client, Number(c.user_id), total, 'chat_refund', {
        type: 'conversation',
        id: Number(c.id),
        note: 'Pengguna diblokir',
      });
      refund = {
        conversationId: Number(c.id),
        userId: Number(c.user_id),
        hostId: Number(c.host_id),
        amount: total,
        messageIds: held.map((r) => Number(r.id)),
      };
    }
    return { refund };
  });
}

async function unblockUser(blockerId, targetIdRaw) {
  const targetId = v.id(targetIdRaw, 'userId');
  await db.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [blockerId, targetId]);
}

async function listBlocked(blockerId) {
  const { rows } = await db.query(
    `SELECT u.id, u.display_name, u.username, u.avatar_url, u.role, b.created_at
     FROM blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
    [blockerId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_url,
    role: r.role,
    blockedAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------

async function createReport(reporterId, body) {
  const targetId = v.id(body.targetId, 'targetId');
  if (targetId === reporterId) throw badRequest('Tidak bisa melaporkan diri sendiri');
  const reason = v.str(body.reason, 'Alasan', { pattern: new RegExp(`^(${Object.keys(REPORT_REASONS).join('|')})$`) });
  const details = v.str(body.details, 'Keterangan', { max: 500, optional: true }) ?? null;
  const conversationId = body.conversationId === undefined || body.conversationId === null ? null : v.id(body.conversationId, 'conversationId');
  const messageId = body.messageId === undefined || body.messageId === null ? null : v.id(body.messageId, 'messageId');

  const { rows: targets } = await db.query(`SELECT id, role FROM users WHERE id = $1`, [targetId]);
  if (!targets.length) throw notFound('Pengguna tidak ditemukan');
  if (targets[0].role === 'admin') throw forbidden('Akun ini tidak bisa dilaporkan');

  // Laporan yang sama (masih diproses) tidak dibuat dua kali
  const { rows: dup } = await db.query(
    `SELECT id FROM reports WHERE reporter_id = $1 AND target_id = $2 AND status = 'pending' LIMIT 1`,
    [reporterId, targetId]
  );
  if (dup.length) return { id: Number(dup[0].id), duplicate: true };

  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > now() - interval '24 hours'`,
    [reporterId]
  );
  if (cnt[0].n >= DAILY_REPORT_LIMIT) {
    throw new ApiError(429, 'TOO_MANY_REPORTS', 'Batas laporan hari ini tercapai. Coba lagi besok.');
  }

  let evidence = null;
  if (conversationId) {
    const { rows: cr } = await db.query(
      `SELECT user_id, host_id FROM conversations WHERE id = $1 AND (user_id = $2 OR host_id = $2)`,
      [conversationId, reporterId]
    );
    if (!cr.length) throw notFound('Percakapan tidak ditemukan');
    const peer = Number(cr[0].user_id) === reporterId ? Number(cr[0].host_id) : Number(cr[0].user_id);
    if (peer !== targetId) throw badRequest('Percakapan ini bukan dengan pengguna yang dilaporkan');
    if (messageId) {
      const { rows: mr } = await db.query(`SELECT id FROM messages WHERE id = $1 AND conversation_id = $2`, [messageId, conversationId]);
      if (!mr.length) throw notFound('Pesan tidak ditemukan');
    }
    const { rows: msgs } = await db.query(
      `SELECT id, sender_id, type, body, created_at FROM messages
       WHERE conversation_id = $1 ORDER BY id DESC LIMIT ${EVIDENCE_MESSAGES}`,
      [conversationId]
    );
    evidence = msgs.reverse().map((m) => ({
      id: Number(m.id),
      from: m.sender_id === null ? 'system' : Number(m.sender_id) === reporterId ? 'pelapor' : 'terlapor',
      type: m.type,
      body: m.body,
      at: m.created_at,
    }));
  } else if (messageId) {
    throw badRequest('messageId butuh conversationId');
  }

  const { rows } = await db.query(
    `INSERT INTO reports (reporter_id, target_id, conversation_id, message_id, reason, details, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [reporterId, targetId, conversationId, messageId, reason, details, evidence ? JSON.stringify(evidence) : null]
  );
  return { id: Number(rows[0].id), duplicate: false };
}

module.exports = {
  REPORT_REASONS,
  notBlockedSql,
  blockerBetween,
  assertNotBlocked,
  blockUser,
  unblockUser,
  listBlocked,
  createReport,
};

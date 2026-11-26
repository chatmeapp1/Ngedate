const db = require('../db');
const wallet = require('./wallet');
const safety = require('./safety');
const membership = require('./membership');
const storage = require('../lib/storage');
const { getSettings } = require('./settings');
const { containsContact } = require('../lib/contactFilter');
const { ApiError, badRequest, forbidden, notFound } = require('../lib/errors');
const v = require('../lib/validate');
const realtime = require('../realtime');

const MAX_TEXT = 1000;
// Pesan beruntun dari host yang boleh dikirim sebelum user membalas
const HOST_UNANSWERED_LIMIT = 3;
const MAX_GIFT_COUNT = 999;

// ---------------------------------------------------------------------------
// Bentuk data yang dikirim ke aplikasi
// ---------------------------------------------------------------------------

function mapMessage(r) {
  return {
    id: Number(r.id),
    conversationId: Number(r.conversation_id),
    senderId: r.sender_id === null ? null : Number(r.sender_id),
    type: r.type,
    body: r.body,
    gift: r.gift_id
      ? {
          id: r.gift_id,
          name: r.gift_name,
          icon: r.gift_icon,
          category: r.gift_category,
          price: r.gift_price != null ? Number(r.gift_price) : null,
          imageUrl: r.gift_image_url,
          animationUrl: r.gift_animation_url,
          animationBlend: !!r.gift_animation_blend,
          soundUrl: r.gift_sound_url,
          count: r.gift_count,
        }
      : null,
    price: Number(r.price),
    paymentStatus: r.payment_status,
    // gift: diamond yang diterima host (host melihat ini, bukan harga gift)
    hostIncome: r.host_income == null ? null : Number(r.host_income),
    // Media privat host: URL lewat API terproteksi; pengguna wajib membuka dengan koin dulu
    mediaPrivate: !!r.media_private,
    mediaPrice: Number(r.media_price || 0),
    mediaUnlocked: !!r.media_private && (Number(r.media_price || 0) === 0 || r.media_unlock_user != null),
    mediaUrl: r.media_private ? `/api/media/${r.id}` : r.media_url || null,
    freeCard: !!r.free_card,
    createdAt: r.created_at,
  };
}

function mapConversation(r, viewerId) {
  const isUser = Number(r.user_id) === viewerId;
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    hostId: Number(r.host_id),
    role: isUser ? 'user' : 'host',
    peer: r.peer_id
      ? {
          id: Number(r.peer_id),
          displayName: r.peer_display_name,
          avatarUrl: r.peer_avatar_url,
          lastSeenAt: r.peer_last_seen_at,
          verified: !!r.peer_verified,
          role: r.peer_role,
          online: realtime.isOnline(Number(r.peer_id)),
        }
      : undefined,
    giftTotal: Number(r.gift_total),
    waUnlocked: !!r.wa_unlocked_at,
    unread: isUser ? r.user_unread : r.host_unread,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
  };
}

const MESSAGE_SELECT = `
  SELECT m.*, g.name AS gift_name, g.image_url AS gift_image_url, g.icon AS gift_icon,
         g.category AS gift_category, g.price AS gift_price,
         g.animation_url AS gift_animation_url, g.animation_blend AS gift_animation_blend,
         g.sound_url AS gift_sound_url, mu.user_id AS media_unlock_user
  FROM messages m LEFT JOIN gifts g ON g.id = m.gift_id LEFT JOIN media_unlocks mu ON mu.message_id = m.id`;

async function fetchMessage(client, id) {
  const { rows } = await client.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
  return mapMessage(rows[0]);
}

function waLink(number) {
  let digits = String(number || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return digits ? `https://wa.me/${digits}` : null;
}

// ---------------------------------------------------------------------------
// Percakapan
// ---------------------------------------------------------------------------

async function getOrCreateConversation(userId, hostIdRaw) {
  const hostId = v.id(hostIdRaw, 'hostId');
  if (hostId === userId) throw badRequest('Tidak bisa chat dengan diri sendiri');

  const { rows: people } = await db.query(
    `SELECT id, role, status, host_status FROM users WHERE id = ANY($1::bigint[])`,
    [[userId, hostId]]
  );
  const me = people.find((p) => Number(p.id) === userId);
  const host = people.find((p) => Number(p.id) === hostId);
  if (!host || host.role !== 'host' || host.status !== 'active' || host.host_status !== 'approved') {
    throw notFound('Host tidak ditemukan');
  }
  if (!me || me.role !== 'user') throw forbidden('Hanya user yang bisa memulai chat dengan host');
  await safety.assertNotBlocked(db, userId, hostId);

  const { rows } = await db.query(
    `INSERT INTO conversations (user_id, host_id) VALUES ($1, $2)
     ON CONFLICT (user_id, host_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, hostId]
  );
  return getConversation(userId, rows[0].id);
}

/**
 * Host menyapa pengguna pria lebih dulu. Pesan host selalu gratis; koin user baru
 * berpindah ke host setelah user membalas dan host membalas lagi.
 */
async function getOrCreateConversationAsHost(hostId, userIdRaw) {
  const userId = v.id(userIdRaw, 'userId');
  if (userId === hostId) throw badRequest('Tidak bisa chat dengan diri sendiri');

  const { rows: people } = await db.query(
    `SELECT id, role, status, host_status, gender, profile_completed FROM users WHERE id = ANY($1::bigint[])`,
    [[userId, hostId]]
  );
  const me = people.find((p) => Number(p.id) === hostId);
  const user = people.find((p) => Number(p.id) === userId);
  if (!me || me.role !== 'host' || me.status !== 'active' || me.host_status !== 'approved') {
    throw forbidden('Hanya host yang sudah disetujui yang bisa menyapa pengguna');
  }
  if (!user || user.role !== 'user' || user.status !== 'active' || user.gender !== 'male' || !user.profile_completed) {
    throw notFound('Pengguna tidak ditemukan');
  }
  await safety.assertNotBlocked(db, hostId, userId);

  const { rows } = await db.query(
    `INSERT INTO conversations (user_id, host_id) VALUES ($1, $2)
     ON CONFLICT (user_id, host_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, hostId]
  );
  return getConversation(hostId, rows[0].id);
}

async function getConversation(viewerId, convId) {
  const { rows } = await db.query(
    `SELECT c.*, p.id AS peer_id, p.display_name AS peer_display_name,
            p.avatar_url AS peer_avatar_url, p.last_seen_at AS peer_last_seen_at,
            p.verified AS peer_verified, p.role AS peer_role
     FROM conversations c
     JOIN users p ON p.id = CASE WHEN c.user_id = $2 THEN c.host_id ELSE c.user_id END
     WHERE c.id = $1 AND (c.user_id = $2 OR c.host_id = $2)`,
    [v.id(convId, 'conversationId'), viewerId]
  );
  if (!rows.length) throw notFound('Percakapan tidak ditemukan');
  if ((await safety.blockerBetween(db, viewerId, Number(rows[0].peer_id))) !== null) throw notFound('Percakapan tidak ditemukan');
  return mapConversation(rows[0], viewerId);
}

async function listConversations(viewerId, { before } = {}) {
  const params = [viewerId];
  let cursor = '';
  if (before) {
    params.push(new Date(before));
    cursor = `AND c.last_message_at < $2`;
  }
  const { rows } = await db.query(
    `SELECT c.*, p.id AS peer_id, p.display_name AS peer_display_name,
            p.avatar_url AS peer_avatar_url, p.last_seen_at AS peer_last_seen_at,
            p.verified AS peer_verified, p.role AS peer_role
     FROM conversations c
     JOIN users p ON p.id = CASE WHEN c.user_id = $1 THEN c.host_id ELSE c.user_id END
     WHERE (c.user_id = $1 OR c.host_id = $1) AND c.last_message_at IS NOT NULL AND ${safety.notBlockedSql('p', 1)} ${cursor}
     ORDER BY c.last_message_at DESC
     LIMIT 50`,
    params
  );
  return rows.map((r) => mapConversation(r, viewerId));
}

async function lockConversation(client, convId, viewerId) {
  const { rows } = await client.query(`SELECT * FROM conversations WHERE id = $1 FOR UPDATE`, [convId]);
  const conv = rows[0];
  if (!conv || (Number(conv.user_id) !== viewerId && Number(conv.host_id) !== viewerId)) {
    throw notFound('Percakapan tidak ditemukan');
  }
  return conv;
}

async function touchConversation(client, conv, senderIsUser, preview) {
  await client.query(
    `UPDATE conversations
     SET last_message_at = now(),
         last_message_preview = $2,
         user_unread = CASE WHEN $3 THEN user_unread ELSE user_unread + 1 END,
         host_unread = CASE WHEN $3 THEN host_unread + 1 ELSE host_unread END
     WHERE id = $1`,
    [conv.id, preview.slice(0, 120), senderIsUser]
  );
}

async function insertMessage(client, fields) {
  const { rows } = await client.query(
    `INSERT INTO messages (conversation_id, sender_id, type, body, gift_id, gift_count, price, payment_status, settled_at, free_card, media_url, media_private, media_price, media_file)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar, CASE WHEN $8::varchar IN ('paid', 'refunded') THEN now() END, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      fields.conversationId,
      fields.senderId ?? null,
      fields.type,
      fields.body ?? null,
      fields.giftId ?? null,
      fields.giftCount ?? null,
      fields.price ?? 0,
      fields.paymentStatus ?? 'free',
      !!fields.freeCard,
      fields.mediaUrl ?? null,
      !!fields.mediaPrivate,
      fields.mediaPrice ?? 0,
      fields.mediaFile ?? null,
    ]
  );
  return Number(rows[0].id);
}

// ---------------------------------------------------------------------------
// Pesan teks berbayar
// ---------------------------------------------------------------------------

/**
 * Host membalas: semua koin yang ditahan di percakapan ini dibagi ke host & platform.
 */
async function settleHeld(client, conv, settings) {
  const { rows } = await client.query(
    `UPDATE messages SET payment_status = 'paid', settled_at = now()
     WHERE conversation_id = $1 AND payment_status = 'held'
     RETURNING id, price`,
    [conv.id]
  );
  if (!rows.length) return null;
  const total = rows.reduce((sum, r) => sum + Number(r.price), 0);
  const { host } = await wallet.payHost(client, Number(conv.host_id), total, settings, 'chat', {
    type: 'conversation',
    id: Number(conv.id),
    note: `${rows.length} pesan dibalas`,
  });
  return { messages: rows.length, coins: total, hostIncome: host, messageIds: rows.map((r) => Number(r.id)) };
}

async function sendText(senderId, convIdRaw, bodyRaw) {
  const convId = v.id(convIdRaw, 'conversationId');
  const body = v.str(bodyRaw, 'Pesan', { min: 1, max: MAX_TEXT });
  if (containsContact(body)) {
    throw new ApiError(422, 'CONTACT_BLOCKED', 'Dilarang membagikan nomor HP, link, atau akun sosial media lewat chat');
  }

  return db.tx(async (client) => {
    const conv = await lockConversation(client, convId, senderId);
    const settings = await getSettings(client);
    const senderIsUser = Number(conv.user_id) === senderId;
    await safety.assertNotBlocked(client, senderId, senderIsUser ? Number(conv.host_id) : Number(conv.user_id));

    // Host boleh menyapa duluan (gratis), tapi tidak menumpuk pesan tanpa balasan dari user
    if (!senderIsUser) {
      const { rows: tail } = await client.query(
        `SELECT COUNT(*)::int AS n FROM messages
         WHERE conversation_id = $1 AND type = 'text' AND sender_id = $2
           AND id > COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = $1 AND sender_id = $3), 0)`,
        [conv.id, senderId, conv.user_id]
      );
      if (tail[0].n >= HOST_UNANSWERED_LIMIT) {
        throw new ApiError(429, 'WAIT_FOR_REPLY', `Tunggu balasan dulu — kamu sudah mengirim ${HOST_UNANSWERED_LIMIT} pesan tanpa balasan`);
      }
    }

    let price = 0;
    if (senderIsUser) {
      const { rows } = await client.query(`SELECT chat_price FROM host_profiles WHERE user_id = $1`, [conv.host_id]);
      price = rows.length ? Number(rows[0].chat_price) : 0;
    }

    // Kartu pesan gratis (VIP): pesan ke host berbayar tanpa potong koin, host dibayar app
    let freeCard = false;
    if (senderIsUser && price > 0) {
      await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [senderId]); // cegah balapan penghitungan kartu
      const m = await membership.summary(client, senderId, settings);
      freeCard = m.freeCardsLeft > 0;
    }

    const messageId = await insertMessage(client, {
      conversationId: conv.id,
      senderId,
      type: 'text',
      body,
      price: freeCard ? 0 : price,
      paymentStatus: price > 0 && !freeCard ? 'held' : 'free',
      freeCard,
    });
    if (freeCard) {
      const bonus = Math.max(0, Math.round(Number(settings.free_card_host_diamonds)));
      if (bonus > 0) await wallet.creditDiamonds(client, Number(conv.host_id), bonus, 'free_card_income', { type: 'message', id: messageId });
    } else if (price > 0) {
      await wallet.debitCoins(client, senderId, price, 'chat_hold', { type: 'message', id: messageId });
    }

    const settled = senderIsUser ? null : await settleHeld(client, conv, settings);
    await touchConversation(client, conv, senderIsUser, body);

    return {
      conversationId: Number(conv.id),
      userId: Number(conv.user_id),
      hostId: Number(conv.host_id),
      message: await fetchMessage(client, messageId),
      settled,
      freeCard,
    };
  });
}

// ---------------------------------------------------------------------------
// Foto & video (fitur VIP)
// ---------------------------------------------------------------------------

async function sendMedia(senderId, convIdRaw, req) {
  const convId = v.id(convIdRaw, 'conversationId');
  // Cek hak akses dulu sebelum file disimpan ke disk
  const check = await db.tx(async (client) => {
    const conv = await lockConversation(client, convId, senderId);
    if (Number(conv.user_id) !== senderId) throw forbidden('Hanya pengguna VIP yang bisa mengirim foto/video');
    await safety.assertNotBlocked(client, senderId, Number(conv.host_id));
    const settings = await getSettings(client);
    const m = await membership.summary(client, senderId, settings);
    if (m.vip < 1) throw new ApiError(403, 'VIP_REQUIRED', 'Kirim foto dan video khusus pengguna VIP');
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM messages
       WHERE sender_id = $1 AND type IN ('image', 'video') AND created_at >= ${membership.DAY_START_SQL}`,
      [senderId]
    );
    const limit = Number(settings.vip_media_per_day);
    if (rows[0].n >= limit) throw new ApiError(429, 'MEDIA_LIMIT', `Batas kirim foto/video hari ini (${limit}) sudah tercapai`);
    return { hostId: Number(conv.host_id) };
  });
  const saved = await storage.saveChatMedia(req);

  try {
    return await db.tx(async (client) => {
      const conv = await lockConversation(client, convId, senderId);
      const messageId = await insertMessage(client, {
        conversationId: conv.id,
        senderId,
        type: saved.kind,
        body: saved.kind === 'image' ? 'Foto' : 'Video',
        mediaUrl: saved.url,
        paymentStatus: 'free',
      });
      await touchConversation(client, conv, true, saved.kind === 'image' ? '📷 Foto' : '🎥 Video');
      return {
        conversationId: Number(conv.id),
        userId: Number(conv.user_id),
        hostId: check.hostId,
        message: await fetchMessage(client, messageId),
      };
    });
  } catch (e) {
    await storage.remove(saved.url);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Gift & buka WhatsApp
// ---------------------------------------------------------------------------

// Buka nomor WhatsApp host jika total belanja koin di percakapan ini sudah memenuhi syarat
async function maybeUnlockWa(client, conv, giftTotal) {
  let unlocked = false;
  let systemMessage = null;
  if (!conv.wa_unlocked_at) {
    const { rows: hp } = await client.query(
      `SELECT wa_enabled, wa_number, wa_unlock_threshold FROM host_profiles WHERE user_id = $1`,
      [conv.host_id]
    );
    const p = hp[0];
    if (p && p.wa_enabled && p.wa_number && giftTotal >= Number(p.wa_unlock_threshold)) {
      await client.query(`UPDATE conversations SET wa_unlocked_at = now() WHERE id = $1`, [conv.id]);
      const sysId = await insertMessage(client, {
        conversationId: conv.id,
        type: 'system',
        body: 'Selamat! Nomor WhatsApp host sudah terbuka 🎉',
      });
      systemMessage = await fetchMessage(client, sysId);
      unlocked = true;
    }
  }
  return { unlocked, systemMessage };
}

// ---------------------------------------------------------------------------
// Foto & video PRIVAT dari host (dibuka pengguna dengan koin)
// ---------------------------------------------------------------------------

/** Host mengirim foto/video privat dengan harga buka yang ia tentukan. File sudah disimpan di folder privat oleh multer. */
async function sendPrivateMedia(senderId, convIdRaw, req) {
  const file = req.file;
  if (!file) throw badRequest('File wajib diisi', 'FILE_REQUIRED');
  const remove = () => require('fs').promises.unlink(file.path).catch(() => {});
  try {
    const convId = v.id(convIdRaw, 'conversationId');
    const settings = await getSettings();
    const price = v.int(req.body.price ?? 0, 'Harga buka', { min: 0, max: Number(settings.host_media_price_max) });
    const checked = await storage.checkPrivateMedia(file, { maxVideoSeconds: Number(settings.host_video_max_seconds) });
    const kind = checked.kind;
    return await db.tx(async (client) => {
      const conv = await lockConversation(client, convId, senderId);
      if (Number(conv.host_id) !== senderId) throw forbidden('Hanya host yang bisa mengirim foto/video privat');
      await safety.assertNotBlocked(client, senderId, Number(conv.user_id));
      const { rows: cnt } = await client.query(
        `SELECT COUNT(*)::int AS n FROM messages WHERE sender_id = $1 AND media_private AND created_at >= ${membership.DAY_START_SQL}`,
        [senderId]
      );
      const limit = Number(settings.host_media_per_day);
      if (cnt[0].n >= limit) throw new ApiError(429, 'MEDIA_LIMIT', `Batas kirim foto/video privat hari ini (${limit}) sudah tercapai`);
      const messageId = await insertMessage(client, {
        conversationId: conv.id,
        senderId,
        type: kind,
        body: kind === 'image' ? 'Foto privat' : 'Video privat',
        paymentStatus: 'free',
        mediaPrivate: true,
        mediaPrice: price,
        mediaFile: require('path').basename(file.path),
      });
      await touchConversation(client, conv, false, kind === 'image' ? '🔒 Foto privat' : '🔒 Video privat');
      return {
        conversationId: Number(conv.id),
        userId: Number(conv.user_id),
        hostId: Number(conv.host_id),
        message: await fetchMessage(client, messageId),
      };
    });
  } catch (e) {
    await remove();
    throw e;
  }
}

/** Pengguna membuka media privat: koin dipotong seperti gift (host menerima bagian gift), file bisa diakses setelahnya. */
async function unlockMedia(userId, convIdRaw, messageIdRaw) {
  const convId = v.id(convIdRaw, 'conversationId');
  const messageId = v.id(messageIdRaw, 'messageId');
  return db.tx(async (client) => {
    const conv = await lockConversation(client, convId, userId);
    if (Number(conv.user_id) !== userId) throw forbidden('Hanya pengguna yang bisa membuka media ini');
    await safety.assertNotBlocked(client, userId, Number(conv.host_id));
    const { rows } = await client.query(`SELECT * FROM messages WHERE id = $1 AND conversation_id = $2 AND media_private FOR UPDATE`, [messageId, conv.id]);
    if (!rows.length) throw notFound('Media tidak ditemukan');
    const m = rows[0];
    const { rows: done } = await client.query(`SELECT 1 FROM media_unlocks WHERE message_id = $1`, [messageId]);
    const base = { conversationId: Number(conv.id), userId: Number(conv.user_id), hostId: Number(conv.host_id) };
    if (done.length) return { ...base, message: await fetchMessage(client, messageId), systemMessage: null, already: true, paid: 0 };

    const price = Number(m.media_price);
    const settings = await getSettings(client);
    let giftTotal = Number(conv.gift_total);
    if (price > 0) {
      await wallet.debitCoins(client, userId, price, 'media_unlock', { type: 'message', id: messageId });
      const { host } = await wallet.payHost(client, Number(conv.host_id), price, settings, 'media', { type: 'message', id: messageId }, { share: Number(settings.gift_host_share) });
      await client.query(`UPDATE messages SET host_income = $2 WHERE id = $1`, [messageId, host]);
      const { rows: upd } = await client.query(`UPDATE conversations SET gift_total = gift_total + $2 WHERE id = $1 RETURNING gift_total`, [conv.id, price]);
      giftTotal = Number(upd[0].gift_total);
    }
    await client.query(`INSERT INTO media_unlocks (message_id, user_id, paid) VALUES ($1, $2, $3)`, [messageId, userId, price]);
    const { unlocked, systemMessage } = await maybeUnlockWa(client, conv, giftTotal);
    return { ...base, message: await fetchMessage(client, messageId), systemMessage, already: false, paid: price, unlockedWa: unlocked, giftTotal };
  });
}

async function sendGift(senderId, convIdRaw, giftIdRaw, countRaw) {
  const convId = v.id(convIdRaw, 'conversationId');
  const giftId = v.id(giftIdRaw, 'giftId');
  const count = v.int(countRaw ?? 1, 'Jumlah', { min: 1, max: MAX_GIFT_COUNT });

  return db.tx(async (client) => {
    const conv = await lockConversation(client, convId, senderId);
    if (Number(conv.user_id) !== senderId) throw forbidden('Hanya user yang bisa mengirim gift ke host');
    await safety.assertNotBlocked(client, senderId, Number(conv.host_id));

    const { rows: giftRows } = await client.query(`SELECT * FROM gifts WHERE id = $1 AND active`, [giftId]);
    if (!giftRows.length) throw notFound('Gift tidak ditemukan');
    const gift = giftRows[0];
    const total = Number(gift.price) * count;
    if (!Number.isSafeInteger(total)) throw badRequest('Jumlah terlalu besar');

    const settings = await getSettings(client);
    const messageId = await insertMessage(client, {
      conversationId: conv.id,
      senderId,
      type: 'gift',
      body: `${gift.name} x${count}`,
      giftId,
      giftCount: count,
      price: total,
      paymentStatus: 'paid',
    });
    await wallet.debitCoins(client, senderId, total, 'gift_send', { type: 'message', id: messageId });
    const { host } = await wallet.payHost(
      client,
      Number(conv.host_id),
      total,
      settings,
      'gift',
      { type: 'message', id: messageId },
      { share: Number(settings.gift_host_share), multiplier: Number(gift.host_multiplier) || 1 }
    );
    await client.query(`UPDATE messages SET host_income = $2 WHERE id = $1`, [messageId, host]);

    const { rows: upd } = await client.query(
      `UPDATE conversations SET gift_total = gift_total + $2 WHERE id = $1 RETURNING gift_total`,
      [conv.id, total]
    );
    const giftTotal = Number(upd[0].gift_total);
    await touchConversation(client, conv, true, `🎁 ${gift.name} x${count}`);

    // Cek syarat buka WhatsApp
    const { unlocked, systemMessage } = await maybeUnlockWa(client, conv, giftTotal);

    return {
      conversationId: Number(conv.id),
      userId: Number(conv.user_id),
      hostId: Number(conv.host_id),
      message: await fetchMessage(client, messageId),
      systemMessage,
      giftTotal,
      unlocked,
      hostIncome: host,
    };
  });
}

async function whatsappStatus(viewerId, convIdRaw) {
  const convId = v.id(convIdRaw, 'conversationId');
  const { rows } = await db.query(
    `SELECT c.user_id, c.host_id, c.gift_total, c.wa_unlocked_at,
            hp.wa_enabled, hp.wa_number, hp.wa_unlock_threshold
     FROM conversations c LEFT JOIN host_profiles hp ON hp.user_id = c.host_id
     WHERE c.id = $1 AND (c.user_id = $2 OR c.host_id = $2)`,
    [convId, viewerId]
  );
  if (!rows.length) throw notFound('Percakapan tidak ditemukan');
  const r = rows[0];
  const unlocked = !!r.wa_unlocked_at;
  const isUser = Number(r.user_id) === viewerId;
  const canSeeNumber = isUser && unlocked && !!r.wa_number;
  return {
    enabled: !!(r.wa_enabled && r.wa_number),
    threshold: r.wa_unlock_threshold === null ? null : Number(r.wa_unlock_threshold),
    giftTotal: Number(r.gift_total),
    unlocked,
    number: canSeeNumber ? r.wa_number : null,
    link: canSeeNumber ? waLink(r.wa_number) : null,
  };
}

// ---------------------------------------------------------------------------
// Riwayat pesan & tanda dibaca
// ---------------------------------------------------------------------------

async function listMessages(viewerId, convIdRaw, { before, limit } = {}) {
  const convId = v.id(convIdRaw, 'conversationId');
  const n = v.int(limit ?? 30, 'limit', { min: 1, max: 100 });
  const { rows: c } = await db.query(
    `SELECT 1 FROM conversations WHERE id = $1 AND (user_id = $2 OR host_id = $2)`,
    [convId, viewerId]
  );
  if (!c.length) throw notFound('Percakapan tidak ditemukan');

  const params = [convId, n];
  let cursor = '';
  if (before) {
    params.push(v.id(before, 'before'));
    cursor = 'AND m.id < $3';
  }
  const { rows } = await db.query(
    `${MESSAGE_SELECT} WHERE m.conversation_id = $1 ${cursor} ORDER BY m.id DESC LIMIT $2`,
    params
  );
  return rows.reverse().map(mapMessage);
}

async function markRead(viewerId, convIdRaw) {
  const convId = v.id(convIdRaw, 'conversationId');
  const { rowCount } = await db.query(
    `UPDATE conversations
     SET user_unread = CASE WHEN user_id = $2 THEN 0 ELSE user_unread END,
         host_unread = CASE WHEN host_id = $2 THEN 0 ELSE host_unread END
     WHERE id = $1 AND (user_id = $2 OR host_id = $2)`,
    [convId, viewerId]
  );
  if (!rowCount) throw notFound('Percakapan tidak ditemukan');
}

// ---------------------------------------------------------------------------
// Refund otomatis: pesan yang tidak dibalas dalam batas waktu
// ---------------------------------------------------------------------------

async function refundExpired() {
  const settings = await getSettings();
  const hours = Number(settings.reply_window_hours);
  const { rows: convs } = await db.query(
    `SELECT DISTINCT conversation_id FROM messages
     WHERE payment_status = 'held' AND created_at < now() - ($1 * interval '1 hour')
     LIMIT 200`,
    [hours]
  );

  const results = [];
  for (const { conversation_id: convId } of convs) {
    const result = await db.tx(async (client) => {
      const { rows: cr } = await client.query(`SELECT * FROM conversations WHERE id = $1 FOR UPDATE`, [convId]);
      if (!cr.length) return null;
      const { rows } = await client.query(
        `UPDATE messages SET payment_status = 'refunded', settled_at = now()
         WHERE conversation_id = $1 AND payment_status = 'held'
           AND created_at < now() - ($2 * interval '1 hour')
         RETURNING id, price, sender_id`,
        [convId, hours]
      );
      if (!rows.length) return null;
      const total = rows.reduce((sum, r) => sum + Number(r.price), 0);
      const userId = Number(cr[0].user_id);
      await wallet.creditCoins(client, userId, total, 'chat_refund', {
        type: 'conversation',
        id: convId,
        note: `${rows.length} pesan tidak dibalas`,
      });
      return {
        conversationId: Number(convId),
        userId,
        hostId: Number(cr[0].host_id),
        amount: total,
        messageIds: rows.map((r) => Number(r.id)),
      };
    });
    if (result) results.push(result);
  }
  return results;
}

module.exports = {
  getOrCreateConversation,
  getOrCreateConversationAsHost,
  getConversation,
  listConversations,
  sendText,
  sendMedia,
  sendPrivateMedia,
  unlockMedia,
  sendGift,
  whatsappStatus,
  listMessages,
  markRead,
  refundExpired,
  waLink,
};

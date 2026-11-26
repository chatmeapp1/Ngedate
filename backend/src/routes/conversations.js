const express = require('express');
const db = require('../db');
const chat = require('../services/chat');
const wallet = require('../services/wallet');
const realtime = require('../realtime');
const { wrap } = require('../lib/errors');

const router = express.Router();

// Kirim saldo terbaru ke user yang saldonya berubah
async function pushBalances(userIds) {
  for (const id of new Set(userIds)) {
    const b = await wallet.balances(db, id);
    if (b) realtime.emitTo(id, 'wallet:update', b);
  }
}

// Kirim pesan baru ke kedua pihak, masing-masing dengan ringkasan percakapan versinya sendiri
async function pushMessage(result, message) {
  for (const id of [result.userId, result.hostId]) {
    const conversation = await chat.getConversation(id, result.conversationId);
    realtime.emitTo(id, 'message:new', { conversationId: result.conversationId, message, conversation });
  }
}

router.get('/', wrap(async (req, res) => {
  res.json(await chat.listConversations(req.user.id, { before: req.query.before }));
}));

// Total pesan belum dibaca (badge di tab Pesan)
router.get('/unread-count', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN user_id = $1 THEN user_unread ELSE host_unread END), 0)::int AS total
     FROM conversations WHERE user_id = $1 OR host_id = $1`,
    [req.user.id]
  );
  res.json({ total: rows[0].total });
}));

// Buka (atau buat) percakapan. User memakai { hostId }, host memakai { userId } (menyapa duluan, gratis)
router.post('/', wrap(async (req, res) => {
  if (req.body.userId !== undefined) {
    return res.json(await chat.getOrCreateConversationAsHost(req.user.id, req.body.userId));
  }
  res.json(await chat.getOrCreateConversation(req.user.id, req.body.hostId));
}));

router.get('/:id', wrap(async (req, res) => {
  res.json(await chat.getConversation(req.user.id, req.params.id));
}));

router.get('/:id/messages', wrap(async (req, res) => {
  res.json(await chat.listMessages(req.user.id, req.params.id, req.query));
}));

router.post('/:id/messages', wrap(async (req, res) => {
  const result = await chat.sendText(req.user.id, req.params.id, req.body.body);
  await pushMessage(result, result.message);
  if (result.settled) {
    // Beri tahu user: pesannya yang ditahan sekarang sudah dibayar karena host membalas
    realtime.emitTo(result.userId, 'chat:settled', {
      conversationId: result.conversationId,
      messageIds: result.settled.messageIds,
    });
  }
  await pushBalances(result.settled ? [result.userId, result.hostId] : [req.user.id]);
  res.status(201).json({ message: result.message, settled: result.settled });
}));

router.post('/:id/gifts', wrap(async (req, res) => {
  const result = await chat.sendGift(req.user.id, req.params.id, req.body.giftId, req.body.count);
  await pushMessage(result, result.message);
  if (result.systemMessage) {
    await pushMessage(result, result.systemMessage);
    realtime.emitTo(result.userId, 'wa:unlocked', { conversationId: result.conversationId });
  }
  await pushBalances([result.userId, result.hostId]);
  res.status(201).json({
    message: result.message,
    systemMessage: result.systemMessage,
    giftTotal: result.giftTotal,
    waUnlocked: result.unlocked,
  });
}));

router.get('/:id/whatsapp', wrap(async (req, res) => {
  res.json(await chat.whatsappStatus(req.user.id, req.params.id));
}));

router.post('/:id/read', wrap(async (req, res) => {
  await chat.markRead(req.user.id, req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.pushBalances = pushBalances;

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

// Buka (atau buat) percakapan dengan host
router.post('/', wrap(async (req, res) => {
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

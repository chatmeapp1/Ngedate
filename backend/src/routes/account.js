const express = require('express');
const rateLimit = require('express-rate-limit');
const account = require('../services/account');
const realtime = require('../realtime');
const { wrap } = require('../lib/errors');
const { pushBalances } = require('./conversations');

const router = express.Router();

// Batasi percobaan (mis. menebak password lama)
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false }));

router.post('/password', wrap(async (req, res) => {
  const session = await account.changePassword(req.user.id, req.body || {});
  res.json({ ok: true, ...session });
}));

router.post('/username', wrap(async (req, res) => {
  res.json({ ok: true, username: await account.changeUsername(req.user.id, (req.body || {}).username) });
}));

router.post('/logout-all', wrap(async (req, res) => {
  await account.logoutAll(req.user.id);
  res.json({ ok: true });
}));

router.post('/delete', wrap(async (req, res) => {
  const { refunds } = await account.deleteAccount(req.user.id, req.body || {});
  realtime.disconnectUser(req.user.id);
  // Pihak lain yang koinnya ikut dikembalikan diberi tahu
  for (const r of refunds.filter((x) => x.userId !== req.user.id)) {
    realtime.emitTo(r.userId, 'chat:refunded', { conversationId: r.conversationId, amount: r.amount, messageIds: r.messageIds });
    await pushBalances([r.userId]);
  }
  res.json({ ok: true });
}));

module.exports = router;

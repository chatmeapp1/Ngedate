const express = require('express');
const safety = require('../services/safety');
const realtime = require('../realtime');
const { wrap } = require('../lib/errors');
const { pushBalances } = require('./conversations');

// ---------------------------------------------------------------------------
// /api/blocks
// ---------------------------------------------------------------------------
const blocks = express.Router();

blocks.get('/', wrap(async (req, res) => {
  res.json(await safety.listBlocked(req.user.id));
}));

blocks.post('/', wrap(async (req, res) => {
  const { refund } = await safety.blockUser(req.user.id, req.body.userId);
  if (refund) {
    realtime.emitTo(refund.userId, 'chat:refunded', {
      conversationId: refund.conversationId,
      amount: refund.amount,
      messageIds: refund.messageIds,
    });
    await pushBalances([refund.userId]);
  }
  res.status(201).json({ ok: true, refunded: refund ? refund.amount : 0 });
}));

blocks.delete('/:userId', wrap(async (req, res) => {
  await safety.unblockUser(req.user.id, req.params.userId);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// /api/reports
// ---------------------------------------------------------------------------
const reports = express.Router();

// Alasan yang dipilih di aplikasi
reports.get('/reasons', (req, res) => {
  res.json(Object.entries(safety.REPORT_REASONS).map(([key, label]) => ({ key, label })));
});

reports.post('/', wrap(async (req, res) => {
  const r = await safety.createReport(req.user.id, req.body || {});
  res.status(r.duplicate ? 200 : 201).json({ ok: true, duplicate: r.duplicate });
}));

module.exports = { blocks, reports };

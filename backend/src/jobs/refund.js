const chat = require('../services/chat');
const realtime = require('../realtime');
const { pushBalances } = require('../routes/conversations');

/**
 * Kembalikan koin untuk pesan yang tidak dibalas host dalam batas waktu
 * (setting reply_window_hours), lalu beri tahu user lewat socket.
 */
async function runRefundJob() {
  const results = await chat.refundExpired();
  for (const r of results) {
    realtime.emitTo(r.userId, 'chat:refunded', {
      conversationId: r.conversationId,
      amount: r.amount,
      messageIds: r.messageIds,
    });
    await pushBalances([r.userId]);
  }
  return results;
}

function startRefundJob(intervalMs) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const results = await runRefundJob();
      if (results.length) console.log(`[refund] ${results.length} percakapan dikembalikan koinnya`);
    } catch (e) {
      console.error('[refund] gagal:', e.message);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { runRefundJob, startRefundJob };

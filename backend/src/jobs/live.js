const live = require('../services/live');
const config = require('../config');

/** Menyelaraskan status siaran dengan media server tiap beberapa detik. */
function startLiveJob(intervalMs = 3000) {
  if (!config.liveMediaApi) return null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await live.syncOnce();
    } catch (e) {
      console.error('[live]', e.message);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { startLiveJob };

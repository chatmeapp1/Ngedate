const salary = require('../services/salary');

const TICK_SECONDS = 30;
const SWEEP_EVERY = 10; // tiap 10 tick (5 menit) semua host program diperiksa

/** Mencatat waktu online host program dan membayar gaji pokok otomatis begitu syaratnya terpenuhi. */
function startSalaryJob() {
  let n = 0;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await salary.tick(TICK_SECONDS);
      n += 1;
      if (n % SWEEP_EVERY === 0) {
        const paid = await salary.sweep();
        if (paid) console.log(`[gaji] ${paid} host dibayar gaji pokok`);
      }
    } catch (e) {
      console.error('[gaji]', e.message);
    } finally {
      running = false;
    }
  }, TICK_SECONDS * 1000);
  timer.unref();
  return timer;
}

module.exports = { startSalaryJob };

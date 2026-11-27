const db = require('../db');
const realtime = require('../realtime');

/**
 * Notifikasi sistem untuk satu pengguna. Tidak pernah melempar error supaya tidak
 * menggagalkan aksi utama (top up, persetujuan foto, dsb.).
 * type: topup | photo | avatar | moment | agency | withdraw
 */
async function notify(userId, type, title, body) {
  try {
    const { rows } = await db.query(
      `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, type, title, body]
    );
    realtime.emitTo(Number(userId), 'notification:new', { id: Number(rows[0].id), type, title, body });
  } catch (e) {
    console.error('[notify]', e.message);
  }
}

const rupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const money = (w) => (w.currency === 'USD' ? `$${(Number(w.net) / 100).toFixed(2)}` : rupiah(w.net));

module.exports = { notify, rupiah, money };

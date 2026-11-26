const { Server } = require('socket.io');
const db = require('./db');
const { verifyAccessToken } = require('./lib/tokens');

let io = null;

/**
 * Socket.io: setiap koneksi WAJIB membawa access token (handshake.auth.token).
 * User otomatis masuk room `user:<id>`; server mengirim event ke room itu.
 *
 * Event dari server:
 *   message:new      { conversationId, message, conversation }
 *   wallet:update    { coins, diamonds }
 *   wa:unlocked      { conversationId }
 *   chat:refunded    { conversationId, amount, messageIds }
 *   typing           { conversationId, userId }
 * Event dari aplikasi:
 *   typing           { conversationId }
 */
function attach(httpServer) {
  // Ping lebih sering supaya koneksi mati (pindah jaringan, HP tidur) cepat terdeteksi dan menyambung ulang
  io = new Server(httpServer, { cors: { origin: '*' }, pingInterval: 10_000, pingTimeout: 8_000 });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const { id } = verifyAccessToken(token);
      const { rows } = await db.query(`SELECT id, status FROM users WHERE id = $1`, [id]);
      if (!rows.length || rows[0].status !== 'active') return next(new Error('UNAUTHORIZED'));
      socket.data.userId = id;
      next();
    } catch (e) {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(`user:${userId}`);
    db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]).catch(() => {});

    socket.on('typing', async (data) => {
      const convId = Number(data && data.conversationId);
      if (!Number.isSafeInteger(convId)) return;
      const { rows } = await db
        .query(`SELECT user_id, host_id FROM conversations WHERE id = $1`, [convId])
        .catch(() => ({ rows: [] }));
      const c = rows[0];
      if (!c) return;
      const other = Number(c.user_id) === userId ? Number(c.host_id) : Number(c.host_id) === userId ? Number(c.user_id) : null;
      if (!other) return;
      const blocked = await db
        .query(`SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`, [userId, other])
        .catch(() => ({ rows: [{}] }));
      if (blocked.rows.length) return;
      io.to(`user:${other}`).emit('typing', { conversationId: convId, userId });
    });

    socket.on('disconnect', () => {
      db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]).catch(() => {});
    });
  });

  return io;
}

function emitTo(userIds, event, payload) {
  if (!io) return;
  for (const id of [].concat(userIds)) io.to(`user:${id}`).emit(event, payload);
}

// Putuskan semua koneksi socket seorang user (mis. akun dihapus)
function disconnectUser(userId) {
  if (!io) return;
  io.in(`user:${userId}`).disconnectSockets(true);
}

function isOnline(userId) {
  if (!io) return false;
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return !!room && room.size > 0;
}

// Semua id user yang sedang tersambung (online)
function onlineUserIds() {
  if (!io) return [];
  const ids = [];
  for (const [name, members] of io.sockets.adapter.rooms) {
    if (name.startsWith('user:') && members.size > 0) ids.push(Number(name.slice(5)));
  }
  return ids;
}

module.exports = { attach, emitTo, isOnline, onlineUserIds, disconnectUser };

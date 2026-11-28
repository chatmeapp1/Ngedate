const crypto = require('crypto');
const querystring = require('querystring');
const db = require('../db');
const config = require('../config');
const realtime = require('../realtime');
const safety = require('./safety');
const { getSettings } = require('./settings');
const { levelOf } = require('./membership');
const { containsContact } = require('../lib/contactFilter');
const { ApiError, badRequest, forbidden, notFound, conflict } = require('../lib/errors');

/**
 * Live stream tahap 1.
 *   Host   : POST /api/live/start -> dapat alamat RTMP + kunci siaran; menyiarkan dari aplikasi RTMP (OBS, Larix, dll).
 *   Server : MediaMTX menerima RTMP dan menyajikan LL-HLS. Setiap publish/read dicek ke /api/live-media/auth.
 *   Backend: job sinkron membaca /v3/paths/list MediaMTX; siaran 'waiting' menjadi 'live' begitu publisher siap,
 *            dan berakhir otomatis bila terputus lebih dari DROP_GRACE_MS atau tidak pernah mulai (WAIT_TIMEOUT_MS).
 *   Penonton: memutar HLS lewat /live-hls/..., ikut obrolan live lewat socket (live:join) dan REST (chat).
 */
const DROP_GRACE_MS = 30_000;
const WAIT_TIMEOUT_MS = 15 * 60_000;
const CHAT_MAX = 200;
const CHAT_GAP_MS = 1200;
const CHAT_KEEP = 80;
const PATH_RE = /^live\/([a-f0-9]{16})$/;

const chatBuffers = new Map(); // streamId -> pesan terbaru
const lastChatAt = new Map(); // userId -> waktu pesan terakhir
const peaks = new Map(); // streamId -> penonton tertinggi (disimpan saat siaran berakhir)

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function ingestInfo(row, secret) {
  return {
    id: Number(row.id),
    status: row.status,
    title: row.title,
    publicId: row.public_id,
    rtmpUrl: config.liveRtmpPublic,
    streamKey: `${row.public_id}?user=live&pass=${secret}`,
  };
}

/** Host membuat siaran baru (atau memutar ulang kunci siaran yang masih menunggu). */
async function start(hostId, titleRaw) {
  const title = String(titleRaw || '').trim().slice(0, 60);
  if (title && containsContact(title)) {
    throw new ApiError(422, 'CONTACT_BLOCKED', 'Judul tidak boleh berisi nomor HP, link, atau akun sosial media');
  }
  return db.tx(async (client) => {
    const { rows: u } = await client.query(`SELECT role, status, host_status, verified FROM users WHERE id = $1 FOR UPDATE`, [hostId]);
    if (!u.length || u[0].role !== 'host') throw forbidden('Hanya host yang bisa live');
    if (u[0].status !== 'active' || u[0].host_status !== 'approved') throw forbidden('Akun host belum aktif');
    if (!u[0].verified) throw new ApiError(403, 'NOT_VERIFIED', 'Selesaikan verifikasi wajah dulu sebelum live');

    const { rows: cur } = await client.query(`SELECT * FROM live_streams WHERE host_id = $1 AND status <> 'ended' FOR UPDATE`, [hostId]);
    const secret = crypto.randomBytes(12).toString('hex');
    if (cur.length) {
      if (cur[0].status === 'live') throw conflict('Siaran kamu sedang berlangsung', 'LIVE_ACTIVE');
      const { rows } = await client.query(
        `UPDATE live_streams SET title = $2, secret_hash = $3, created_at = now() WHERE id = $1 RETURNING *`,
        [cur[0].id, title, sha(secret)]
      );
      return ingestInfo(rows[0], secret);
    }
    const publicId = crypto.randomBytes(8).toString('hex');
    const { rows } = await client.query(
      `INSERT INTO live_streams (host_id, title, public_id, secret_hash) VALUES ($1, $2, $3, $4) RETURNING *`,
      [hostId, title, publicId, sha(secret)]
    );
    return ingestInfo(rows[0], secret);
  });
}

/** Dipanggil MediaMTX (authMethod http). Mengembalikan true bila diizinkan. */
async function authorize({ action, path, query, password }) {
  const m = PATH_RE.exec(String(path || ''));
  if (!m) return false;
  const { rows } = await db.query(
    `SELECT s.status, s.secret_hash, u.status AS host_status FROM live_streams s JOIN users u ON u.id = s.host_id WHERE s.public_id = $1`,
    [m[1]]
  );
  const s = rows[0];
  if (!s || s.status === 'ended' || s.host_status !== 'active') return false;
  if (action === 'publish') {
    const pass = querystring.parse(String(query || '')).pass || password || '';
    return !!pass && safeEq(sha(pass), s.secret_hash);
  }
  if (action === 'read' || action === 'playback') return true;
  return false;
}

async function kickPublisher(publicId) {
  if (!config.liveMediaApi) return;
  try {
    const r = await fetch(`${config.liveMediaApi}/v3/paths/get/live/${publicId}`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return;
    const p = await r.json();
    if (p.source && p.source.type === 'rtmpConn' && p.source.id) {
      await fetch(`${config.liveMediaApi}/v3/rtmpconns/kick/${p.source.id}`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    }
  } catch (e) {
    /* media server tidak terjangkau: siaran tetap ditandai berakhir */
  }
}

/** Mengakhiri siaran. reason: host | admin | dropped | timeout. */
async function end(id, reason) {
  const peak = Math.max(peaks.get(Number(id)) || 0, realtime.liveCount(id));
  const { rows } = await db.query(
    `UPDATE live_streams SET status = 'ended', ended_at = now(), ended_reason = $2, peak_viewers = GREATEST(peak_viewers, $3)
     WHERE id = $1 AND status <> 'ended' RETURNING *`,
    [id, reason, peak]
  );
  if (!rows.length) return null;
  const s = rows[0];
  realtime.emitLive(Number(s.id), 'live:ended', { id: Number(s.id), reason });
  realtime.emitTo(Number(s.host_id), 'live:ended', { id: Number(s.id), reason });
  realtime.closeLiveRoom(Number(s.id));
  chatBuffers.delete(Number(s.id));
  peaks.delete(Number(s.id));
  kickPublisher(s.public_id);
  return s;
}

async function endByHost(hostId, id) {
  const { rows } = await db.query(`SELECT host_id FROM live_streams WHERE id = $1`, [id]);
  if (!rows.length || Number(rows[0].host_id) !== hostId) throw notFound('Siaran tidak ditemukan');
  await end(id, 'host');
  return { ok: true };
}

/**
 * Menyelaraskan status dengan daftar path MediaMTX (items dari GET /v3/paths/list).
 * waiting -> live saat publisher siap; live yang terputus > DROP_GRACE_MS berakhir; waiting terlalu lama berakhir.
 */
async function syncFromPaths(items) {
  const ready = new Set((items || []).filter((i) => i && i.ready).map((i) => i.name));
  const { rows } = await db.query(`SELECT * FROM live_streams WHERE status <> 'ended'`);
  const now = Date.now();
  for (const s of rows) {
    const isReady = ready.has(`live/${s.public_id}`);
    if (isReady) {
      if (s.status !== 'live') {
        await db.query(`UPDATE live_streams SET status = 'live', started_at = COALESCE(started_at, now()), disconnected_at = NULL WHERE id = $1`, [s.id]);
        realtime.emitTo(Number(s.host_id), 'live:started', { id: Number(s.id) });
      } else if (s.disconnected_at) {
        await db.query(`UPDATE live_streams SET disconnected_at = NULL WHERE id = $1`, [s.id]);
      }
    } else if (s.status === 'live') {
      if (!s.disconnected_at) {
        await db.query(`UPDATE live_streams SET disconnected_at = now() WHERE id = $1`, [s.id]);
      } else if (now - new Date(s.disconnected_at).getTime() > DROP_GRACE_MS) {
        await end(s.id, 'dropped');
      }
    } else if (now - new Date(s.created_at).getTime() > WAIT_TIMEOUT_MS) {
      await end(s.id, 'timeout');
    }
  }
}

let warned = false;
async function syncOnce() {
  if (!config.liveMediaApi) return;
  let items;
  try {
    const r = await fetch(`${config.liveMediaApi}/v3/paths/list?itemsPerPage=1000`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    items = (await r.json()).items || [];
    warned = false;
  } catch (e) {
    if (!warned) console.warn('[live] media server tidak terjangkau:', e.message);
    warned = true;
    return; // jangan mengakhiri siaran hanya karena API media server tidak terjangkau
  }
  await syncFromPaths(items);
}

const hostBrief = (r) => ({
  id: Number(r.host_id),
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  verified: !!r.verified,
  countryCode: r.country_code || null,
});

async function listLive(viewerId) {
  const { rows } = await db.query(
    `SELECT s.id, s.title, s.started_at, s.host_id, u.display_name, u.avatar_url, u.verified, u.country_code
     FROM live_streams s JOIN users u ON u.id = s.host_id
     WHERE s.status = 'live' AND u.status = 'active' AND ${safety.notBlockedSql('u', 1)}
     ORDER BY s.started_at DESC LIMIT 50`,
    [viewerId]
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, startedAt: r.started_at, viewers: realtime.liveCount(Number(r.id)), host: hostBrief(r) }));
}

async function load(id, viewerId) {
  const { rows } = await db.query(
    `SELECT s.*, u.display_name, u.avatar_url, u.verified, u.country_code, u.status AS host_account
     FROM live_streams s JOIN users u ON u.id = s.host_id WHERE s.id = $1`,
    [id]
  );
  if (!rows.length) throw notFound('Siaran tidak ditemukan');
  const s = rows[0];
  if (Number(s.host_id) !== viewerId && (await safety.blockerBetween(db, viewerId, Number(s.host_id)))) throw notFound('Siaran tidak ditemukan');
  return s;
}

async function detail(id, viewerId) {
  const s = await load(id, viewerId);
  const live = s.status !== 'ended';
  return {
    id: Number(s.id),
    title: s.title,
    status: s.status,
    startedAt: s.started_at,
    endedReason: s.ended_reason,
    viewers: realtime.liveCount(Number(s.id)),
    playbackUrl: live ? `/live-hls/live/${s.public_id}/index.m3u8` : null,
    host: hostBrief(s),
    chat: chatBuffers.get(Number(s.id)) || [],
  };
}

/** Dipakai socket (live:join): siaran yang boleh ditonton oleh pengguna ini, atau null. */
async function watchable(userId, id) {
  try {
    const s = await load(id, userId);
    return s.status === 'ended' ? null : s;
  } catch (e) {
    return null;
  }
}

function notePeak(id, count) {
  if (count > (peaks.get(id) || 0)) peaks.set(id, count);
}

async function hostCurrent(hostId) {
  const { rows } = await db.query(`SELECT * FROM live_streams WHERE host_id = $1 AND status <> 'ended'`, [hostId]);
  if (!rows.length) return null;
  const s = rows[0];
  return { id: Number(s.id), status: s.status, title: s.title, startedAt: s.started_at, viewers: realtime.liveCount(Number(s.id)), disconnected: !!s.disconnected_at };
}

async function sendChat(userId, id, bodyRaw) {
  const body = String(bodyRaw || '').trim();
  if (!body) throw badRequest('Pesan kosong');
  if (body.length > CHAT_MAX) throw badRequest(`Pesan maksimal ${CHAT_MAX} karakter`);
  const s = await load(id, userId);
  if (s.status !== 'live') throw conflict('Siaran tidak sedang berlangsung', 'NOT_LIVE');
  if (containsContact(body)) throw new ApiError(422, 'CONTACT_BLOCKED', 'Dilarang membagikan nomor HP, link, atau akun sosial media');
  const last = lastChatAt.get(userId) || 0;
  if (Date.now() - last < CHAT_GAP_MS) throw new ApiError(429, 'TOO_FAST', 'Terlalu cepat, tunggu sebentar');
  lastChatAt.set(userId, Date.now());

  const { rows } = await db.query(`SELECT id, display_name, avatar_url, role, topup_total FROM users WHERE id = $1`, [userId]);
  const u = rows[0];
  const settings = await getSettings(db);
  const message = {
    id: crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    body,
    user: {
      id: Number(u.id),
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      role: u.role,
      isHost: Number(u.id) === Number(s.host_id),
      level: u.role === 'host' ? null : levelOf(Number(u.topup_total || 0), settings.level_thresholds),
    },
  };
  const buf = chatBuffers.get(Number(s.id)) || [];
  buf.push(message);
  if (buf.length > CHAT_KEEP) buf.shift();
  chatBuffers.set(Number(s.id), buf);
  realtime.emitLive(Number(s.id), 'live:chat', { id: Number(s.id), message });
  return message;
}

// ---- Admin ----
async function adminList() {
  const { rows } = await db.query(
    `SELECT s.*, u.display_name, u.username FROM live_streams s JOIN users u ON u.id = s.host_id
     WHERE s.status <> 'ended' OR s.ended_at > now() - interval '7 days' ORDER BY (s.status <> 'ended') DESC, s.created_at DESC LIMIT 60`
  );
  return rows.map((s) => ({
    id: Number(s.id),
    hostId: Number(s.host_id),
    hostName: s.display_name,
    hostUsername: s.username,
    title: s.title,
    status: s.status,
    viewers: realtime.liveCount(Number(s.id)),
    peakViewers: Math.max(Number(s.peak_viewers), peaks.get(Number(s.id)) || 0),
    startedAt: s.started_at,
    endedAt: s.ended_at,
    endedReason: s.ended_reason,
  }));
}

module.exports = {
  start,
  authorize,
  end,
  endByHost,
  syncOnce,
  syncFromPaths,
  listLive,
  detail,
  watchable,
  notePeak,
  hostCurrent,
  sendChat,
  adminList,
  DROP_GRACE_MS,
};

const crypto = require('crypto');
const fs = require('fs');
const db = require('../db');
const realtime = require('../realtime');

/**
 * Notifikasi push lewat Firebase Cloud Messaging (HTTP v1), tanpa SDK tambahan.
 * Aktif jika ada kunci service account Firebase:
 *   FCM_SERVICE_ACCOUNT       = path file JSON service account, atau
 *   FCM_SERVICE_ACCOUNT_JSON  = isi JSON-nya
 * Tanpa kunci ini, semua fungsi di sini diam (tidak error).
 */
let config; // undefined = belum dibaca, null = tidak ada
let cached = { token: null, exp: 0 };

function loadConfig() {
  if (config !== undefined && !process.env.FCM_RELOAD) return config;
  config = null;
  try {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON || (process.env.FCM_SERVICE_ACCOUNT ? fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT, 'utf8') : null);
    if (raw) {
      const j = JSON.parse(raw);
      if (j.client_email && j.private_key && j.project_id) config = j;
    }
  } catch (e) {
    console.warn('[push] kunci FCM tidak bisa dibaca:', e.message);
  }
  return config;
}

const b64url = (b) => Buffer.from(b).toString('base64url');

async function accessToken(cfg) {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: cfg.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claim}`), cfg.private_key).toString('base64url');
  const res = await fetch(process.env.FCM_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${sig}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token FCM: ${json.error_description || json.error || res.status}`);
  cached = { token: json.access_token, exp: now + Number(json.expires_in || 3600) };
  return cached.token;
}

function enabled() {
  return !!loadConfig();
}

async function sendOne(cfg, token, tokenValue, message) {
  const res = await fetch(`${process.env.FCM_BASE_URL || 'https://fcm.googleapis.com'}/v1/projects/${cfg.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token: tokenValue, ...message } }),
  });
  if (res.ok) return true;
  const json = await res.json().catch(() => ({}));
  const status = json.error && json.error.status;
  // Token sudah tidak berlaku (aplikasi dihapus / token diganti): bersihkan
  if (res.status === 404 || status === 'NOT_FOUND' || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') {
    await db.query(`DELETE FROM push_tokens WHERE token = $1`, [tokenValue]).catch(() => {});
  } else {
    console.warn('[push] gagal kirim:', res.status, (json.error && json.error.message) || '');
  }
  return false;
}

/**
 * Kirim notifikasi ke satu pengguna (semua perangkatnya).
 * Dilewati jika pengguna sedang online (sudah menerima lewat realtime), kecuali opts.force.
 * data: pasangan string untuk dibuka di aplikasi (mis. { type: 'chat', conversationId: '12' }).
 */
async function notify(userId, { title, body, data = {} }, opts = {}) {
  const cfg = loadConfig();
  if (!cfg) return;
  if (!opts.force && realtime.isOnline(Number(userId))) return;
  try {
    const { rows } = await db.query(`SELECT token FROM push_tokens WHERE user_id = $1`, [userId]);
    if (!rows.length) return;
    const at = await accessToken(cfg);
    const strData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    const message = {
      notification: { title: String(title).slice(0, 80), body: String(body).slice(0, 180) },
      data: strData,
      android: { priority: 'HIGH', notification: { channel_id: 'messages', sound: 'default' } },
    };
    await Promise.all(rows.map((r) => sendOne(cfg, at, r.token, message)));
  } catch (e) {
    console.warn('[push] error:', e.message);
  }
}

// Jalankan di latar belakang: kegagalan push tidak boleh menggagalkan permintaan utama
function notifyLater(userId, payload, opts) {
  notify(userId, payload, opts).catch(() => {});
}

module.exports = { notify, notifyLater, enabled };

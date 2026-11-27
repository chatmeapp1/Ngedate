const crypto = require('crypto');
const db = require('../db');
const { ApiError, badRequest } = require('../lib/errors');

/**
 * Terjemahan teks (tombol "Terjemah" di chat, momen, dsb.).
 * Penyedia: endpoint terjemahan Google tanpa kunci (tidak resmi, bisa dibatasi sewaktu-waktu). Untuk produksi
 * penuh, ganti `callProvider` dengan Google Cloud Translation resmi tanpa mengubah bagian lain.
 * Hasil di-cache per (teks, bahasa tujuan) dan tiap pengguna dibatasi jumlah permintaannya.
 */
const LANGS = { id: 'id', en: 'en', ms: 'ms', th: 'th', vi: 'vi', tl: 'tl', zh: 'zh-CN', ja: 'ja', ko: 'ko', ar: 'ar', hi: 'hi', es: 'es', pt: 'pt' };
const MAX_CHARS = 1000;
const LIMIT = { windowMs: 10 * 60 * 1000, max: 80 }; // 80 terjemahan baru per 10 menit per pengguna
const TIMEOUT_MS = 8000;

let fetchImpl = (...args) => fetch(...args); // dapat diganti saat tes
const hits = new Map(); // userId -> [timestamp]

function setFetch(fn) {
  fetchImpl = fn;
}
function resetLimits() {
  hits.clear();
}

function checkLimit(userId) {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter((t) => now - t < LIMIT.windowMs);
  if (list.length >= LIMIT.max) {
    throw new ApiError(429, 'TRANSLATE_LIMIT', 'Terlalu banyak terjemahan. Coba lagi beberapa menit lagi.');
  }
  list.push(now);
  hits.set(userId, list);
}

async function callProvider(text, to) {
  const base = (process.env.TRANSLATE_BASE || 'https://translate.googleapis.com').replace(/\/$/, '');
  const url = `${base}/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parts = Array.isArray(data && data[0]) ? data[0] : [];
    const result = parts.map((p) => (p && p[0]) || '').join('');
    if (!result) throw new Error('hasil kosong');
    return { result, from: typeof data[2] === 'string' ? data[2] : null };
  } finally {
    clearTimeout(timer);
  }
}

/** Terjemahkan `text` ke bahasa `lang` (kode aplikasi, mis. 'en'). */
async function translate(userId, textRaw, lang) {
  const text = String(textRaw ?? '').trim();
  if (!text) throw badRequest('Teks kosong');
  if (text.length > MAX_CHARS) throw badRequest(`Teks maksimal ${MAX_CHARS} karakter`);
  const to = LANGS[lang];
  if (!to) throw badRequest('Bahasa tujuan tidak didukung');

  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const { rows } = await db.query(`SELECT result, source_lang FROM translation_cache WHERE hash = $1 AND lang = $2`, [hash, lang]);
  if (rows.length) return { text: rows[0].result, from: rows[0].source_lang, cached: true, same: rows[0].result === text };

  checkLimit(userId);
  let out;
  try {
    out = await callProvider(text, to);
  } catch (e) {
    throw new ApiError(502, 'TRANSLATE_FAILED', 'Terjemahan sedang tidak tersedia. Coba lagi nanti.');
  }
  await db.query(
    `INSERT INTO translation_cache (hash, lang, result, source_lang) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [hash, lang, out.result, out.from]
  );
  const same = out.from ? out.from.split('-')[0] === to.split('-')[0] : out.result === text;
  return { text: out.result, from: out.from, cached: false, same };
}

module.exports = { translate, setFetch, resetLimits, LANGS };

'use strict';
/* Panel admin Amora — tanpa library luar. Semua isi dibuat lewat DOM (textContent) agar aman dari XSS. */

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0);
const ago = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

function toast(msg, err) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), err ? 5000 : 2600);
}

function lightbox(src) {
  const box = h('div', { class: 'lightbox', onclick: () => box.remove() }, h('img', { src }));
  document.body.append(box);
}

function avatar(url, name, size) {
  const style = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size / 2.4)}px` : null;
  return url
    ? h('img', { class: 'avatar', src: url, alt: '', style, onclick: () => lightbox(url) })
    : h('div', { class: 'avatar', style }, initial(name));
}

// ---------------------------------------------------------------------------
// API + sesi
// ---------------------------------------------------------------------------
const KEY = 'amora.admin.session';
let session = null;
try {
  session = JSON.parse(localStorage.getItem(KEY) || 'null');
} catch (e) {
  session = null;
}
const saveSession = (s) => {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch (e) { /* abaikan */ }
};

async function raw(method, path, body, form) {
  const headers = {};
  if (session && session.accessToken) headers.authorization = 'Bearer ' + session.accessToken;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(path, { method, headers, body: payload });
}

async function api(method, path, body, form) {
  let res = await raw(method, path, body, form);
  if (res.status === 401 && session && session.refreshToken) {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (r.ok) {
      const t = await r.json();
      saveSession({ ...session, accessToken: t.accessToken, refreshToken: t.refreshToken });
      res = await raw(method, path, body, form);
    } else {
      logout();
      throw new Error('Sesi berakhir, silakan masuk lagi');
    }
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && json.error && json.error.message) || 'Terjadi kesalahan (' + res.status + ')');
  return json;
}
const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b || {});
const patch = (p, b) => api('PATCH', p, b || {});
const put = (p, b) => api('PUT', p, b || {});
const del = (p) => api('DELETE', p);

async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
    return undefined;
  }
}

// Unggah file dengan kemajuan (XHR). Satu kali coba ulang jika token kedaluwarsa.
function xhrUpload(path, file, onProgress, retry = true) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    if (session && session.accessToken) xhr.setRequestHeader('authorization', 'Bearer ' + session.accessToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('Koneksi terputus saat mengunggah'));
    xhr.onload = async () => {
      let json = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch (e) { /* bukan JSON */ }
      if (xhr.status === 401 && retry) {
        try {
          await get('/api/me'); // memicu pembaruan token
          return resolve(await xhrUpload(path, file, onProgress, false));
        } catch (e) {
          return reject(e);
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(json);
      reject(new Error((json && json.error && json.error.message) || 'Gagal mengunggah (' + xhr.status + ')'));
    };
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

// Buat gambar gift (PNG 256x256) dari bingkai video yang paling "berisi".
// Video latar hitam (mode transparan): hitam dijadikan transparan, lalu dipotong rapat.
async function makeThumb(src, blend) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = src;
  await new Promise((resolve, reject) => {
    v.onloadeddata = resolve;
    v.onerror = () => reject(new Error('Browser tidak bisa membaca video ini. Pakai MP4 H.264.'));
  });
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
  const seek = (t) => new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = Math.max(0, Math.min(dur - 0.05, t));
    setTimeout(done, 3000);
  });
  const W = 320;
  const H = Math.max(1, Math.round((W * (v.videoHeight || 1)) / (v.videoWidth || 1)));
  const grab = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, W, H);
    return { c, ctx, data: ctx.getImageData(0, 0, W, H) };
  };

  // Pilih bingkai: yang paling banyak bagian terangnya (latar hitam) atau tengah video
  let best = null;
  const fractions = blend ? [0.1, 0.2, 0.3, 0.45, 0.6, 0.75] : [0.3];
  for (const f of fractions) {
    await seek(dur * f);
    const g = grab();
    let score = 0;
    const d = g.data.data;
    for (let i = 0; i < d.length; i += 4) score += Math.max(d[i], d[i + 1], d[i + 2]);
    if (!best || score > best.score) best = { ...g, score };
  }
  const { data, ctx } = best;
  const d = data.data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  if (blend) {
    // Terang -> buram: alpha = kecerahan tertinggi, warna dikembalikan dari pra-kali
    for (let i = 0; i < d.length; i += 4) {
      const a = Math.min(255, Math.max(d[i], d[i + 1], d[i + 2]) * 1.35);
      if (a > 0) {
        const k = 255 / Math.max(d[i], d[i + 1], d[i + 2], 1);
        d[i] = Math.min(255, d[i] * k);
        d[i + 1] = Math.min(255, d[i + 1] * k);
        d[i + 2] = Math.min(255, d[i + 2] * k);
      }
      d[i + 3] = a;
      if (a > 40) {
        const px = (i / 4) % W;
        const py = Math.floor(i / 4 / W);
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    }
    ctx.putImageData(data, 0, 0);
  }
  if (!blend || x1 <= x0 || y1 <= y0) {
    // Potong persegi di tengah
    const side = Math.min(W, H);
    x0 = Math.floor((W - side) / 2);
    y0 = Math.floor((H - side) / 2);
    x1 = x0 + side;
    y1 = y0 + side;
  }
  const pad = 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W, x1 + pad);
  y1 = Math.min(H, y1 + pad);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const OUT = 256;
  const out = document.createElement('canvas');
  out.width = OUT;
  out.height = OUT;
  const octx = out.getContext('2d');
  const scale = Math.min(OUT / cw, OUT / ch);
  const dw = cw * scale;
  const dh = ch * scale;
  octx.drawImage(best.c, x0, y0, cw, ch, (OUT - dw) / 2, (OUT - dh) / 2, dw, dh);
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Gagal membuat gambar dari video');
  return new File([blob], 'gift.png', { type: 'image/png' });
}

function lightboxVideo(src) {
  const v = h('video', { src, autoplay: true, loop: true, muted: true, playsinline: true, controls: true, style: 'max-width:100%;max-height:100%;border-radius:12px' });
  v.muted = true;
  const box = h('div', { class: 'lightbox', onclick: (e) => e.target === box && box.remove() }, v);
  document.body.append(box);
}

// ---------------------------------------------------------------------------
// Modal formulir
// ---------------------------------------------------------------------------
// fields: [{ name, label, type: text|number|textarea|select|checkbox|file, value, options, hint,
//            accept, maxMB, preview: 'video'|'image', current }]
// onSubmit(values, ui): opsional. Jika ada, modal tetap terbuka selama proses (mis. unggah file),
// menampilkan kemajuan lewat ui.progress(teks, 0..1) dan pesan error jika gagal.
function fmtSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

// Pratinjau & validasi untuk input file
function wireFile(f, input, box) {
  const types = (f.accept || 'image/png,image/jpeg,image/webp').split(',');
  const note = (text, cls) => h('div', { class: cls || 'dim', style: 'margin-top:6px' }, text);
  if (f.current && f.preview === 'audio') {
    box.append(h('div', { class: 'dim', style: 'margin-top:6px' }, 'Suara saat ini:'), h('audio', { src: f.current, controls: true, style: 'width:100%' }));
  } else if (f.current && f.preview === 'video') {
    box.append(h('div', { class: 'dim', style: 'margin-top:6px' }, 'Efek saat ini:'),
      h('video', { class: 'pv', src: f.current, controls: true, muted: true, loop: true, playsinline: true }));
  } else if (f.current && f.preview === 'image') {
    box.append(h('img', { class: 'pv', src: f.current, alt: '' }));
  }
  input.addEventListener('change', () => {
    box.replaceChildren();
    const file = input.files[0];
    if (!file) return;
    if (!types.includes(file.type)) {
      input.value = '';
      box.append(note('Jenis file tidak didukung (' + (file.type || 'tidak dikenal') + '). Pakai: ' + types.map((t) => t.split('/')[1].toUpperCase()).join(', '), 'err-text'));
      return;
    }
    if (f.maxMB && file.size > f.maxMB * 1048576) {
      input.value = '';
      box.append(note('Ukuran ' + fmtSize(file.size) + ' melebihi batas ' + f.maxMB + ' MB. Kecilkan dulu videonya.', 'err-text'));
      return;
    }
    const url = URL.createObjectURL(file);
    const info = note(file.name + ' · ' + fmtSize(file.size));
    const warn = h('div', { class: 'warn-text' });
    let media;
    if (f.preview === 'audio') {
      media = h('audio', { src: url, controls: true, style: 'width:100%' });
    } else if (f.preview === 'video') {
      media = h('video', { class: 'pv', src: url, controls: true, muted: true, loop: true, playsinline: true });
      media.muted = true;
      media.addEventListener('loadedmetadata', () => {
        const d = media.duration;
        info.textContent += ' · ' + d.toFixed(1) + ' dtk';
        if (d > 6.05) warn.textContent = 'Video ' + d.toFixed(1) + ' detik: hanya 6 detik pertama yang diputar, lalu memudar.';
      });
      media.addEventListener('error', () => {
        warn.textContent = 'Browser tidak bisa memutar pratinjau ini. Pakai MP4 H.264 supaya aman di semua HP.';
      });
    } else {
      media = h('img', { class: 'pv', src: url, alt: '' });
    }
    box.append(media, info, warn);
  });
}

function formModal({ title, fields, submit = 'Simpan', danger = false, onSubmit = null }) {
  return new Promise((resolve) => {
    const inputs = {};
    const body = fields.map((f) => {
      let input;
      let extra = null;
      if (f.type === 'textarea') input = h('textarea', { rows: 3, value: f.value ?? '' });
      else if (f.type === 'select') {
        input = h('select', {}, f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
      } else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: f.value });
      else if (f.type === 'file') {
        input = h('input', { type: 'file', accept: f.accept || 'image/png,image/jpeg,image/webp' });
        extra = h('div');
        wireFile(f, input, extra);
      } else input = h('input', { type: f.type || 'text', value: f.value ?? '', autocomplete: 'off', step: f.type === 'number' ? 'any' : null });
      inputs[f.name] = input;
      if (f.type === 'checkbox') return h('label', { class: 'chk' }, input, f.label);
      return h('div', { class: 'f' }, h('label', { class: 'f', style: 'margin:0' }, h('span', {}, f.label), input, f.hint ? h('small', { class: 'hint' }, f.hint) : null), extra);
    });
    let busy = false;
    const close = (v) => {
      if (busy) return;
      wrap.remove();
      resolve(v);
    };
    const bar = h('i');
    const status = h('div', { style: 'display:none;margin:4px 0 12px' },
      h('div', { class: 'progress' }, bar),
      h('div', { class: 'dim', id: 'st', style: 'margin-top:6px' }));
    const stText = status.querySelector('#st');
    const errBox = h('p', { class: 'err-text', style: 'display:none' });
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Batal');
    const ok = h('button', { type: 'submit', class: 'btn ' + (danger ? 'bad' : 'pri') }, submit);
    const ui = {
      progress(text, frac) {
        status.style.display = 'block';
        stText.textContent = text;
        bar.style.width = Math.round(Math.max(0, Math.min(1, frac ?? 0)) * 100) + '%';
      },
    };
    const form = h(
      'form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          if (busy) return;
          const out = {};
          for (const f of fields) {
            const el = inputs[f.name];
            if (f.type === 'checkbox') out[f.name] = el.checked;
            else if (f.type === 'file') out[f.name] = el.files[0] || null;
            else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
            else out[f.name] = el.value.trim();
          }
          if (!onSubmit) return close(out);
          busy = true;
          cancel.disabled = true;
          ok.disabled = true;
          errBox.style.display = 'none';
          try {
            const result = await onSubmit(out, ui);
            busy = false;
            close(result === undefined ? out : result);
          } catch (ex) {
            busy = false;
            cancel.disabled = false;
            ok.disabled = false;
            status.style.display = 'none';
            errBox.textContent = ex.message;
            errBox.style.display = 'block';
          }
        },
      },
      h('h3', {}, title),
      body,
      status,
      errBox,
      h('div', { class: 'acts' }, cancel, ok)
    );
    const wrap = h('div', { class: 'modal-wrap', onmousedown: (e) => e.target === wrap && close(null) }, h('div', { class: 'modal' }, form));
    document.body.append(wrap);
    const first = wrap.querySelector('input:not([type=checkbox]):not([type=file]),textarea,select');
    if (first) first.focus();
  });
}

const confirmModal = async (title, text, submit) => {
  const r = await formModal({ title, fields: [{ name: '_', type: 'checkbox', label: text, value: true }], submit });
  return !!r;
};

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------
const view = { el: null };
let stats = null;

function pageHead(title, lead) {
  return [h('h1', {}, title), lead ? h('p', { class: 'lead' }, lead) : null];
}

const empty = (text) => h('div', { class: 'empty' }, text);

// Kartu "Cek untung/rugi per koin" (angka dari server: GET /api/admin/margin)
const rp2 = (n) => 'Rp ' + n.toFixed(2).replace('.', ',');
function marginCard(m) {
  const ok = m.worst.profit >= 0;
  const row = (k, v, strong) => h('div', { class: 'row', style: 'justify-content:space-between;gap:8px;padding:3px 0' },
    h('span', { class: 'muted' }, k), h('span', { style: strong ? 'font-weight:800' : 'font-weight:600' }, v));
  const scenario = (label, sc) => h('div', { style: 'margin-top:8px;padding:8px 10px;border-radius:12px;background:' + (sc.profit >= 0 ? '#f0fdf4' : '#fef2f2') },
    row(label + ': bersih per koin', rp2(sc.net)),
    row('Untung / rugi per koin', (sc.profit >= 0 ? '+' : '−') + rp2(Math.abs(sc.profit)) + ' (' + sc.profitPct.toFixed(0) + '% dari harga jual)', true));
  return h('div', { class: 'card', style: 'max-width:620px;margin-bottom:18px;border-color:' + (ok ? '#bbf7d0' : '#fecaca') },
    h('div', { class: 'row', style: 'margin-bottom:8px' },
      h('b', { class: 'sp' }, 'Cek untung/rugi per koin'),
      h('span', { class: 'pill ' + (ok ? 'green' : 'red') }, ok ? '✔ Aman, tidak rugi' : '⚠ RUGI')),
    row('Harga jual terendah', rp2(m.pricePerCoin) + ' per koin'),
    row('Bagian host terbesar + komisi agency', Math.round(m.hostShare * 100) + '% + ' + Math.round(m.agencyRate * 100) + '% = ' + Math.round((m.hostShare + m.agencyRate) * 100) + '%' + (m.giftMultiplier > 1 ? ' (gift x' + m.giftMultiplier + ')' : '')),
    row('Nilai 1 diamond (Penarikan)', rp2(m.diamondRp)),
    row('Bayar host + agency per koin', rp2(m.worst.payout), true),
    scenario('Potongan Google Play 30% (terburuk)', m.worst),
    scenario('Potongan Google Play 15%', m.best),
    h('div', { class: 'dim', style: 'margin-top:8px' }, 'PPN 11% sudah dihitung (perkiraan). Belum termasuk pajak penghasilan, server, dan promosi. Server otomatis menolak pengaturan, harga paket, atau komisi agency yang membuat rugi pada skenario terburuk.'));
}


// ----- Dashboard -----
async function pageDashboard() {
  const s = await refreshStats();
  const sources = { chat: 'Pesan chat', gift: 'Gift' };
  const earn = Object.entries(s.platformEarnings);
  const totalEarn = earn.reduce((a, [, v]) => a + v, 0);
  const stat = (n, l, warn) => h('div', { class: 'card stat' + (warn ? ' warn' : '') }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  const pend = s.pending.verifications + s.pending.photos + s.pending.avatars + s.pending.reports + s.pending.withdrawals;
  return [
    pageHead('Dashboard', 'Ringkasan Amora saat ini'),
    pend > 0
      ? h('div', { class: 'card stat warn', style: 'margin-bottom:12px' },
          h('div', { class: 'row wrap' },
            h('b', {}, pend + ' item menunggu tinjauan'),
            h('span', { class: 'sp' }),
            s.pending.verifications ? h('a', { class: 'btn pri sm', href: '#verifikasi' }, 'Verifikasi wajah (' + s.pending.verifications + ')') : null,
            s.pending.photos + s.pending.avatars ? h('a', { class: 'btn pri sm', href: '#foto' }, 'Foto host (' + (s.pending.photos + s.pending.avatars) + ')') : null,
            s.pending.reports ? h('a', { class: 'btn pri sm', href: '#laporan' }, 'Laporan (' + s.pending.reports + ')') : null,
            s.pending.withdrawals ? h('a', { class: 'btn pri sm', href: '#penarikan' }, 'Penarikan (' + s.pending.withdrawals + ' · ' + [s.pendingWithdrawIdr ? 'Rp ' + fmt(s.pendingWithdrawIdr) : null, s.pendingWithdrawUsdCents ? '$' + (s.pendingWithdrawUsdCents / 100).toFixed(2) : null].filter(Boolean).join(' + ') + ')') : null))
      : null,
    h('div', { class: 'grid g3' },
      stat(fmt(s.users.user || 0), 'Pengguna'),
      stat(fmt(s.users.host || 0), 'Host'),
      stat(fmt(s.newUsers24h), 'Pendaftar 24 jam'),
      stat(fmt(s.messages24h), 'Pesan 24 jam'),
      stat(fmt(s.gifts24h), 'Koin gift 24 jam'),
      stat(fmt(s.agencies), 'Agency aktif'),
      stat(fmt(s.coinsInWallets), 'Koin di dompet user'),
      stat(fmt(s.onlineNow || 0), 'Online sekarang'),
      stat(fmt(s.heldCoins), 'Koin ditahan (menunggu balasan)')),
    h('div', { class: 'sec' }, 'Pendapatan platform'),
    h('div', { class: 'card' },
      earn.length
        ? [
            h('dl', { class: 'kv' }, earn.map(([k, v]) => [h('dt', {}, sources[k] || k), h('dd', {}, fmt(v) + ' koin')])),
            h('hr', { style: 'border:0;border-top:1px solid var(--border);margin:12px 0' }),
            h('div', { class: 'row' }, h('b', {}, 'Total'), h('span', { class: 'sp' }), h('b', {}, fmt(totalEarn) + ' koin')),
          ]
        : empty('Belum ada pendapatan')),
  ];
}

// ----- Verifikasi wajah -----
let vfTab = 'pending';
async function pageVerifikasi() {
  const list = await get('/api/admin/verifications?status=' + vfTab);
  const root = h('div');
  const tabs = h('div', { class: 'tabs' }, [['pending', 'Menunggu'], ['approved', 'Disetujui'], ['rejected', 'Ditolak']].map(([k, l]) =>
    h('button', { class: 'tab' + (vfTab === k ? ' on' : ''), onclick: () => { vfTab = k; render(); } }, l)));
  root.append(
    ...pageHead('Verifikasi wajah', 'Cocokkan foto dengan gerakan yang diminta, dan pastikan orangnya sama dengan foto profil.'),
    tabs
  );
  if (!list.length) root.append(empty('Tidak ada data'));
  const grid = h('div', { class: 'grid g2', style: 'grid-template-columns:repeat(auto-fill,minmax(320px,1fr))' });
  for (const v of list) {
    const secs = v.durationMs ? (v.durationMs / 1000).toFixed(1) + ' dtk' : null;
    grid.append(
      h('div', { class: 'card' },
        h('div', { class: 'row' },
          avatar(v.avatarUrl, v.displayName),
          h('div', { class: 'sp' }, h('b', {}, v.displayName), h('div', { class: 'dim' }, '@' + v.username + (v.agencyName ? ' · ' + v.agencyName : ''))),
          h('span', { class: 'dim' }, ago(v.createdAt))),
        h('div', { class: 'photos' }, v.photoUrls.map((u, i) =>
          h('figure', {}, h('img', { src: u, alt: '', onclick: () => lightbox(u) }), h('figcaption', {}, (i + 1) + '. ' + ((v.steps[i] && v.steps[i].text) || ''))))),
        h('div', { class: 'dim' }, [secs ? 'Durasi ' + secs : null, v.rejectReason ? ' · Alasan ditolak: ' + v.rejectReason : null]),
        v.status === 'pending'
          ? h('div', { class: 'row', style: 'margin-top:12px' },
              h('button', { class: 'btn ok sp', onclick: async () => {
                if (await act(() => post('/api/admin/verifications/' + v.id + '/approve'), 'Verifikasi disetujui')) render();
              } }, 'Setujui'),
              h('button', { class: 'btn bad sp', onclick: async () => {
                const r = await formModal({ title: 'Tolak verifikasi', submit: 'Tolak', danger: true,
                  fields: [{ name: 'reason', label: 'Alasan (dilihat host)', type: 'textarea', hint: 'Mis. wajah tidak jelas / gerakan tidak sesuai' }] });
                if (r && await act(() => post('/api/admin/verifications/' + v.id + '/reject', { reason: r.reason }), 'Verifikasi ditolak')) render();
              } }, 'Tolak'))
          : h('span', { class: 'pill ' + (v.status === 'approved' ? 'green' : 'red'), style: 'margin-top:10px' }, v.status === 'approved' ? 'Disetujui' : 'Ditolak'))
    );
  }
  root.append(grid);
  return root;
}

// ----- Foto host -----
async function pagePhotos() {
  const d = await get('/api/admin/photos/pending');
  const root = h('div', {}, pageHead('Foto host', 'Foto profil dan album baru harus disetujui sebelum tampil ke pengguna.'));

  const card = (item, kind) => {
    const key = kind === 'avatar' ? '/api/admin/users/' + item.userId + '/avatar' : '/api/admin/photos/' + item.id;
    return h('div', { class: 'card' },
      h('img', { class: 'thumb', src: item.url, alt: '', onclick: () => lightbox(item.url) }),
      h('div', { style: 'margin:8px 0' }, h('b', {}, item.displayName), h('div', { class: 'dim' }, kind === 'avatar' ? 'Foto profil · ID ' + item.userId : 'Album · ID ' + item.userId)),
      h('div', { class: 'row' },
        h('button', { class: 'btn ok sp sm', onclick: async () => { if (await act(() => post(key + '/approve'), 'Disetujui')) render(); } }, 'Setujui'),
        h('button', { class: 'btn bad sp sm', onclick: async () => {
          let body = {};
          if (kind !== 'avatar') {
            const r = await formModal({ title: 'Tolak foto', submit: 'Tolak', danger: true, fields: [{ name: 'reason', label: 'Alasan', type: 'textarea' }] });
            if (!r) return;
            body = { reason: r.reason };
          } else if (!(await confirmModal('Tolak foto profil', 'Foto profil baru akan dihapus', 'Tolak'))) return;
          if (await act(() => post(key + '/reject', body), 'Ditolak')) render();
        } }, 'Tolak')));
  };

  root.append(h('div', { class: 'sec' }, 'Foto profil baru (' + d.avatars.length + ')'));
  root.append(d.avatars.length ? h('div', { class: 'grid g3' }, d.avatars.map((a) => card(a, 'avatar'))) : empty('Tidak ada'));
  root.append(h('div', { class: 'sec' }, 'Foto album (' + d.album.length + ')'));
  root.append(d.album.length ? h('div', { class: 'grid g3' }, d.album.map((a) => card(a, 'album'))) : empty('Tidak ada'));
  return root;
}

// ----- Momen host -----
const momenFilt = { status: 'pending' };
async function pageMoments() {
  const list = await get('/api/admin/moments?status=' + momenFilt.status);
  const root = h('div', {}, ...pageHead('Momen host', 'Foto momen harus disetujui sebelum tampil ke pengguna. Menolak atau menghapus langsung membuang fotonya dari server.'));
  root.append(h('div', { class: 'tabs' }, [['pending', 'Menunggu'], ['approved', 'Disetujui'], ['rejected', 'Ditolak']].map(([k, l]) =>
    h('button', { class: 'tab' + (momenFilt.status === k ? ' on' : ''), onclick: () => { momenFilt.status = k; render(); } }, l))));
  if (!list.length) { root.append(empty('Tidak ada momen')); return root; }
  root.append(h('div', { class: 'grid g3' }, list.map((m) => h('div', { class: 'card' },
    m.imageUrl ? h('img', { class: 'thumb', src: m.imageUrl, alt: '', onclick: () => lightbox(m.imageUrl) }) : null,
    h('div', { style: 'margin:8px 0' },
      h('b', {}, m.displayName), h('span', { class: 'dim' }, ' · ID ' + m.hostId + ' · ' + new Date(m.createdAt).toLocaleString('id-ID')),
      m.body ? h('div', { style: 'margin-top:4px' }, m.body) : null,
      m.status === 'rejected' && m.rejectReason ? h('div', { class: 'dim' }, 'Alasan: ' + m.rejectReason) : null,
      m.status === 'approved' ? h('div', { class: 'dim' }, m.views + ' dilihat · ' + m.likes + ' suka') : null),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
      m.status !== 'approved' && m.imageUrl !== null ? h('button', { class: 'btn ok sm', onclick: async () => { if (await act(() => post('/api/admin/moments/' + m.id + '/approve'), 'Disetujui')) render(); } }, 'Setujui') : null,
      m.status === 'pending' ? h('button', { class: 'btn bad sm', onclick: async () => {
        const r = await formModal({ title: 'Tolak momen', submit: 'Tolak', danger: true, fields: [{ name: 'reason', label: 'Alasan', type: 'textarea' }] });
        if (r && (await act(() => post('/api/admin/moments/' + m.id + '/reject', { reason: r.reason }), 'Ditolak'))) render();
      } }, 'Tolak') : null,
      h('button', { class: 'btn bad sm', onclick: async () => {
        if (!(await confirmModal('Hapus momen', 'Momen dan fotonya dihapus permanen', 'Hapus'))) return;
        if (await act(() => del('/api/admin/moments/' + m.id), 'Dihapus')) render();
      } }, 'Hapus'))))));
  return root;
}

// ----- Media privat host -----
const mediaFilt = { status: 'approved' };
// File media privat dilindungi: ambil dengan token admin lalu tampilkan lewat blob
async function showPrivateMedia(m) {
  try {
    const res = await raw('GET', '/api/admin/private-media/' + m.id + '/file');
    if (!res.ok) throw new Error('File tidak ditemukan (status ' + res.status + ')');
    const blobUrl = URL.createObjectURL(await res.blob());
    if (m.type === 'video') lightboxVideo(blobUrl);
    else lightbox(blobUrl);
  } catch (e) {
    toast(e.message, true);
  }
}

async function pageMedia() {
  const list = await get('/api/admin/private-media?status=' + mediaFilt.status);
  const root = h('div', {}, ...pageHead('Media privat host', 'Foto dan video privat yang dikirim host di chat langsung sampai ke pengguna. Di sini admin bisa melihat 100 media terbaru dan menghapus yang melanggar: file dibuang dari server, hilang dari chat pengguna, dan host diberi tahu. Koin yang sudah dibayar pengguna tidak dikembalikan otomatis.'));
  root.append(h('div', { class: 'tabs' }, [['approved', 'Terkirim'], ['rejected', 'Dihapus']].map(([k, l]) =>
    h('button', { class: 'tab' + (mediaFilt.status === k ? ' on' : ''), onclick: () => { mediaFilt.status = k; render(); } }, l))));
  if (!list.length) { root.append(empty('Tidak ada media')); return root; }
  root.append(h('div', { class: 'grid g3' }, list.map((m) => h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('b', { class: 'sp' }, m.type === 'video' ? '🎬 Video privat' : '🖼️ Foto privat'),
      h('span', { class: 'pill ' + (m.price > 0 ? 'amber' : '') }, m.price > 0 ? m.price.toLocaleString('id-ID') + ' koin' : 'Gratis')),
    h('div', { style: 'margin:8px 0' },
      h('div', {}, h('b', {}, m.host.displayName), h('span', { class: 'dim' }, ' · ID ' + m.host.id)),
      h('div', { class: 'dim' }, 'Untuk ' + m.userName + ' · ' + new Date(m.createdAt).toLocaleString('id-ID')),
      m.status === 'rejected' && m.reason ? h('div', { class: 'dim' }, 'Alasan: ' + m.reason) : null,
      m.status === 'approved' && m.unlocked ? h('div', { class: 'dim' }, 'Sudah dibuka pengguna') : null),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
      m.hasFile ? h('button', { class: 'btn pri sm', onclick: () => showPrivateMedia(m) }, 'Lihat') : null,
      m.status === 'approved' ? h('button', { class: 'btn bad sm', onclick: async () => {
        const r = await formModal({ title: 'Hapus media', submit: 'Hapus', danger: true, fields: [{ name: 'reason', label: 'Alasan (dikirim ke host)', type: 'textarea', value: 'Melanggar aturan konten' }] });
        if (r && (await act(() => post('/api/admin/private-media/' + m.id + '/reject', { reason: r.reason }), 'Dihapus'))) render();
      } }, 'Hapus') : null)))));
  return root;
}

// ----- Gaji pokok host -----
async function pageSalary() {
  const list = await get('/api/admin/salary');
  const root = h('div', {}, ...pageHead('Gaji pokok host', 'Host yang ditambahkan di sini mendapat gaji pokok mingguan (Senin-Minggu, WIB) secara otomatis setelah online cukup lama di app dan target pendapatan chat + gift tercapai. Gaji dibayar dalam diamond.'));

  const fields = (v) => [
    { name: 'minutesPerDay', label: 'Online di app per hari (menit)', type: 'number', value: v.minutesPerDay ?? 120 },
    { name: 'daysRequired', label: 'Jumlah hari yang harus terpenuhi per minggu (1-7)', type: 'number', value: v.daysRequired ?? 5 },
    { name: 'incomeTarget', label: 'Target pendapatan chat + gift per minggu (diamond)', type: 'number', value: v.incomeTarget ?? 70000, hint: 'Pesan gratis dan penghasilan lain tidak dihitung.' },
    { name: 'reward', label: 'Gaji pokok (diamond)', type: 'number', value: v.reward ?? 70000, hint: 'Diamond host bisa ditarik jadi uang. 1 diamond ≈ Rp 2,55.' },
  ];

  // Cek perkiraan risiko rugi dulu; kalau berisiko, minta konfirmasi sebelum disimpan
  const save = async (hostId, vals, create) => {
    const body = { hostId, minutesPerDay: +vals.minutesPerDay, daysRequired: +vals.daysRequired, incomeTarget: +vals.incomeTarget, reward: +vals.reward };
    const rk = await act(() => get('/api/admin/salary/risk?reward=' + body.reward + '&target=' + body.incomeTarget));
    if (!rk) return false;
    if (rk.risky) {
      const rp = (n) => 'Rp ' + Math.abs(n).toLocaleString('id-ID');
      const ok = await confirmModal('Berisiko rugi',
        'Gaji ' + body.reward.toLocaleString('id-ID') + ' diamond (± ' + rp(rk.salaryRp) + ') lebih besar dari untung app bila target dicapai hanya lewat CHAT: rugi ± ' + rp(rk.chatOnly.lossRp) + ' per host per minggu. ' +
        'Jika target dicapai lewat GIFT, app tetap untung ± ' + rp(rk.giftOnly.lossRp) + '. Tetap simpan?', 'Tetap simpan');
      if (!ok) return false;
      body.force = true;
    }
    return act(() => (create ? post('/api/admin/salary', body) : patch('/api/admin/salary/' + hostId, body)), 'Disimpan');
  };

  root.append(h('div', { class: 'row', style: 'margin-bottom:14px' },
    h('button', { class: 'btn pri', onclick: async () => {
      const r = await formModal({ title: 'Tambah host ke gaji pokok', submit: 'Tambah', fields: [{ name: 'hostId', label: 'ID host', type: 'number', hint: 'ID 6 digit host, mis. 100002 (lihat di menu Pengguna).' }, ...fields({})] });
      if (r && (await save(+r.hostId, r, true))) render();
    } }, '+ Tambah host')));

  if (!list.length) { root.append(empty('Belum ada host di program gaji pokok')); return root; }
  const bar = (v, max) => h('div', { class: 'progress', style: 'height:6px;margin:4px 0' }, h('i', { style: 'width:' + Math.min(100, max ? (v / max) * 100 : 0) + '%' }));
  root.append(h('div', { class: 'grid g3' }, list.map((e) => h('div', { class: 'card', style: e.active ? '' : 'opacity:.55' },
    h('div', { class: 'row' }, h('b', { class: 'sp' }, e.displayName), h('span', { class: 'pill ' + (e.paid ? 'green' : e.active ? 'purple' : '') }, e.paid ? 'Dibayar minggu ini' : e.active ? 'Berjalan' : 'Nonaktif')),
    h('div', { class: 'dim' }, '@' + e.username + ' · ID ' + e.hostId),
    h('div', { class: 'dim', style: 'margin:8px 0 4px' }, e.minutesPerDay + ' menit/hari × ' + e.daysRequired + ' hari · target ' + e.incomeTarget.toLocaleString('id-ID') + ' · gaji ' + e.reward.toLocaleString('id-ID')),
    h('div', {}, 'Hari valid ' + e.validDays + '/' + e.daysRequired), bar(e.validDays, e.daysRequired),
    h('div', {}, 'Pendapatan ' + e.income.toLocaleString('id-ID') + '/' + e.incomeTarget.toLocaleString('id-ID')), bar(e.income, e.incomeTarget),
    h('div', { class: 'dim' }, 'Online hari ini ' + e.todayMinutes + '/' + e.minutesPerDay + ' menit'),
    e.active ? h('div', { class: 'row', style: 'margin-top:10px;gap:6px' },
      h('button', { class: 'btn sm', onclick: async () => {
        const r = await formModal({ title: 'Ubah gaji pokok ' + e.displayName, fields: fields(e) });
        if (r && (await save(e.hostId, r, false))) render();
      } }, 'Ubah'),
      h('button', { class: 'btn bad sm', onclick: async () => {
        if (await confirmModal('Keluarkan dari gaji pokok', e.displayName + ' tidak lagi mengikuti program, menu Gaji pokok di app-nya hilang.', 'Keluarkan') && (await act(() => del('/api/admin/salary/' + e.hostId), 'Dikeluarkan'))) render();
      } }, 'Keluarkan')) : null))));
  return root;
}

// ----- Pengguna -----
const filt = { q: '', role: '', status: '' };
async function pageUsers(param) {
  if (param && /^\d+$/.test(param)) Object.assign(filt, { q: param, role: '', status: '' });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filt)) if (v) qs.set(k, v);
  const list = await get('/api/admin/users?' + qs.toString());
  const root = h('div', {}, pageHead('Pengguna', 'Maksimal 100 hasil terbaru. Gunakan pencarian nama, username, email, atau ID.'));
  const input = h('input', { type: 'search', placeholder: 'Cari…', value: filt.q, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const role = h('select', {}, [['', 'Semua peran'], ['user', 'User'], ['host', 'Host'], ['admin', 'Admin']].map(([v, l]) => h('option', { value: v, selected: filt.role === v }, l)));
  const status = h('select', {}, [['', 'Semua status'], ['active', 'Aktif'], ['suspended', 'Ditangguhkan'], ['deleted', 'Dihapus']].map(([v, l]) => h('option', { value: v, selected: filt.status === v }, l)));
  const go = () => { filt.q = input.value.trim(); filt.role = role.value; filt.status = status.value; render(); };
  role.onchange = go; status.onchange = go;
  root.append(h('div', { class: 'search' }, input, role, status, h('button', { class: 'btn pri', onclick: go }, 'Cari')));
  if (!list.length) root.append(empty('Tidak ada pengguna'));

  const grid = h('div', { class: 'grid g2' });
  for (const u of list) {
    const isAdmin = u.role === 'admin' || u.status === 'deleted';
    grid.append(h('div', { class: 'card' },
      h('div', { class: 'row' },
        avatar(u.avatarUrl, u.displayName),
        h('div', { class: 'sp', style: 'min-width:0' },
          h('div', { class: 'row', style: 'gap:6px' }, h('b', {}, u.displayName), u.verified ? h('span', { class: 'pill purple' }, '✔ verified') : null),
          h('div', { class: 'dim' }, '@' + u.username + ' · ID ' + u.id)),
        h('span', { class: 'pill ' + (u.role === 'host' ? 'purple' : u.role === 'admin' ? 'amber' : '') }, u.role)),
      h('div', { class: 'row wrap', style: 'margin:10px 0;gap:6px' },
        h('span', { class: 'pill' }, u.gender === 'male' ? 'Pria' : u.gender === 'female' ? 'Wanita' : 'Gender -'),
        u.countryCode ? h('span', { class: 'pill' }, u.countryCode) : null,
        u.status === 'suspended' ? h('span', { class: 'pill red' }, 'Ditangguhkan') : null,
        u.status === 'deleted' ? h('span', { class: 'pill red' }, 'Akun dihapus') : null,
        u.role === 'host' && u.hostStatus !== 'approved' ? h('span', { class: 'pill amber' }, 'Host: ' + (u.hostStatus || '-')) : null,
        u.agencyName ? h('span', { class: 'pill' }, u.agencyName) : null,
        !u.profileCompleted && !isAdmin ? h('span', { class: 'pill amber' }, 'Profil belum lengkap') : null),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Koin'), h('dd', {}, fmt(u.coins)),
        h('dt', {}, 'Diamond'), h('dd', {}, fmt(u.diamonds))),
      isAdmin ? null : h('div', { class: 'row wrap', style: 'margin-top:12px;gap:6px' },
        h('a', { class: 'btn sm', href: '#topup/' + u.id, style: 'text-decoration:none' }, '💰 Top up koin'),
        h('button', { class: 'btn sm', onclick: async () => {
          const to = u.role === 'host' ? 'user' : 'host';
          if (await confirmModal(to === 'host' ? 'Jadikan host' : 'Kembalikan ke user', u.displayName + (to === 'host' ? ' langsung disetujui sebagai host.' : ' tidak lagi tampil sebagai host.'), 'Ya')
            && await act(() => patch('/api/admin/users/' + u.id + '/role', { role: to }), 'Peran diubah')) render();
        } }, u.role === 'host' ? 'Jadi user' : 'Jadi host'),
        u.role !== 'admin' ? h('button', { class: 'btn sm', onclick: async () => {
          if (!(await confirmModal('Atur ulang password', 'Password ' + u.displayName + ' diganti password sementara dan semua sesinya keluar. Lakukan hanya setelah memastikan yang meminta benar-benar pemilik akun (mis. tanyakan ID, tanggal lahir, riwayat top up, atau foto profil).', 'Atur ulang'))) return;
          const r = await act(() => post('/api/admin/users/' + u.id + '/reset-password'));
          if (r) await formModal({ title: 'Password sementara', submit: 'Tutup', fields: [{ name: 'p', label: 'Kirim password ini ke pemilik akun', value: r.tempPassword, hint: 'Hanya tampil sekali. Pengguna wajib menggantinya setelah masuk (Login via Akun dengan ID ' + u.id + ').' }] });
        } }, '🔑 Atur ulang password') : null,
        h('button', { class: 'btn sm ' + (u.status === 'suspended' ? 'ok' : 'bad'), onclick: async () => {
          const to = u.status === 'suspended' ? 'active' : 'suspended';
          if (await confirmModal(to === 'suspended' ? 'Tangguhkan akun' : 'Aktifkan akun', u.displayName, 'Ya')
            && await act(() => patch('/api/admin/users/' + u.id + '/status', { status: to }), 'Status diubah')) render();
        } }, u.status === 'suspended' ? 'Aktifkan' : 'Tangguhkan'))));
  }
  root.append(grid);
  return root;
}

// ----- Agency -----
async function pageAgency() {
  const [list, settings] = await Promise.all([get('/api/admin/agencies'), get('/api/admin/settings')]);
  const share = Number(settings.host_share);
  const root = h('div', {}, pageHead('Agency', 'Komisi agency adalah persen dari penghasilan host, dibayar dari bagian app (host tidak berkurang).'));
  const fields = (a) => [
    { name: 'name', label: 'Nama agency', value: a && a.name },
    ...(a ? [] : [{ name: 'code', label: 'Kode undangan', hint: 'Kosongkan untuk dibuat otomatis (4–16 huruf/angka)' }]),
    { name: 'commission', label: 'Komisi agency (% dari penghasilan host)', type: 'number', value: a ? +(a.commissionRate * 100).toFixed(2) : 10, hint: 'Dibayar dari bagian app, host tidak berkurang. Contoh: host dapat 100 diamond, komisi 10% = agency dapat 10 diamond.' },
    { name: 'contact', label: 'Kontak', value: a && a.contact },
    ...(a ? [{ name: 'active', label: 'Aktif (kode bisa dipakai)', type: 'checkbox', value: a.active }] : []),
  ];
  root.append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn pri', onclick: async () => {
    const r = await formModal({ title: 'Agency baru', fields: fields(null), submit: 'Buat' });
    if (!r) return;
    const created = await act(() => post('/api/admin/agencies', { name: r.name, code: r.code || undefined, commissionRate: (r.commission ?? 10) / 100, contact: r.contact || undefined }), 'Agency dibuat');
    if (created) render();
  } }, '+ Agency baru')));
  if (!list.length) root.append(empty('Belum ada agency'));
  const grid = h('div', { class: 'grid g2' });
  for (const a of list) {
    grid.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'sp' }, a.name), h('span', { class: 'pill ' + (a.active ? 'green' : 'red') }, a.active ? 'Aktif' : 'Nonaktif')),
      h('div', { class: 'row', style: 'margin:10px 0' },
        h('span', { class: 'code' }, a.code),
        h('button', { class: 'btn sm', onclick: () => { (navigator.clipboard ? navigator.clipboard.writeText(a.code) : Promise.reject()).then(() => toast('Kode disalin'), () => toast('Salin manual: ' + a.code)); } }, 'Salin')),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Komisi'), h('dd', {}, +(a.commissionRate * 100).toFixed(2) + '%'),
        h('dt', {}, 'Host'), h('dd', {}, fmt(a.hosts)),
        h('dt', {}, 'Total pendapatan'), h('dd', {}, fmt(a.earningsTotal) + ' diamond'),
        h('dt', {}, 'Saldo belum ditarik'), h('dd', {}, fmt(a.balance) + ' diamond'),
        h('dt', {}, 'Login panel'), h('dd', {}, a.loginSet ? a.username : 'belum diatur'),
        h('dt', {}, 'Negara pembayaran'), h('dd', {}, (a.countryCode || 'ID') + ((a.countryCode || 'ID') === 'ID' ? ' (Rupiah)' : ' (USDT)')),
        h('dt', {}, 'Kontak'), h('dd', {}, a.contact || '-')),
      h('div', { class: 'row wrap', style: 'margin-top:12px;gap:6px' }, h('button', { class: 'btn sm', onclick: async () => {
        const r = await formModal({
          title: a.loginSet ? 'Atur login: ' + a.name : 'Buat login: ' + a.name,
          submit: 'Simpan login',
          fields: [
            { name: 'username', label: 'Username', value: a.username || '', hint: 'Huruf, angka, titik, minus, garis bawah (min 4). Agency masuk di ' + location.origin + '/agency' },
            { name: 'password', label: a.loginSet ? 'Password baru (kosongkan jika tidak diganti)' : 'Password awal', type: 'password', hint: 'Minimal 8 karakter. Sampaikan ke agency lewat jalur aman; agency bisa menggantinya sendiri.' },
            { name: 'countryCode', label: 'Negara (menentukan metode penarikan)', type: 'select', value: (a.countryCode || 'ID') === 'ID' ? 'ID' : 'XX', options: [{ value: 'ID', label: 'Indonesia: bank / e-wallet (Rupiah)' }, { value: 'XX', label: 'Negara lain: USDT TRC20 (USD)' }] },
          ],
        });
        if (r && await act(() => put('/api/admin/agencies/' + a.id + '/login', { username: r.username, password: r.password || undefined, countryCode: r.countryCode === 'XX' ? ((a.countryCode && a.countryCode !== 'ID') ? a.countryCode : 'US') : 'ID' }), 'Login agency disimpan')) render();
      } }, a.loginSet ? 'Atur login' : 'Buat login'), h('button', { class: 'btn sm', onclick: async () => {
        const r = await formModal({ title: 'Ubah agency', fields: fields(a) });
        if (r && await act(() => patch('/api/admin/agencies/' + a.id, { name: r.name, commissionRate: (r.commission ?? 0) / 100, contact: r.contact || undefined, active: r.active }), 'Agency diperbarui')) render();
      } }, 'Ubah'))));
  }
  root.append(grid);
  return root;
}


// ----- Top up koin -----
async function pageTopup(param) {
  const root = h('div', {}, pageHead('Top up koin', 'Kirim koin ke pengguna, atau kurangi jika salah kirim. Semuanya tercatat di riwayat.'));
  let selected = null;

  const results = h('div', { class: 'grid g2', style: 'margin-bottom:14px' });
  const formBox = h('div');
  const historyBox = h('div');

  const input = h('input', { type: 'search', placeholder: 'Cari nama, username, atau ID pengguna…', onkeydown: (e) => { if (e.key === 'Enter') doSearch(); } });
  const searchBtn = h('button', { class: 'btn pri', onclick: () => doSearch() }, 'Cari');
  root.append(h('div', { class: 'search' }, input, searchBtn), results, formBox, historyBox);

  async function doSearch(q) {
    const text = (q ?? input.value).trim();
    if (!text) return;
    const list = await act(() => get('/api/admin/users?q=' + encodeURIComponent(text)));
    if (!list) return;
    const found = list.filter((u) => u.role !== 'admin').slice(0, 8);
    results.replaceChildren(...(found.length ? found.map(userRow) : [empty('Pengguna tidak ditemukan')]));
    // Dibuka dari kartu pengguna (#topup/ID): pilih yang ID-nya persis sama
    const exact = found.find((u) => String(u.id) === text);
    if (q && exact) pick(exact);
    else if (found.length === 1) pick(found[0]);
  }

  function userRow(u) {
    return h('div', { class: 'card row' },
      avatar(u.avatarUrl, u.displayName),
      h('div', { class: 'sp', style: 'min-width:0' }, h('b', {}, u.displayName), h('div', { class: 'dim' }, '@' + u.username + ' · ID ' + u.id + ' · ' + fmt(u.coins) + ' koin')),
      h('button', { class: 'btn sm pri', onclick: () => pick(u) }, 'Pilih'));
  }

  function pick(u) {
    selected = u;
    results.replaceChildren();
    drawForm();
    drawHistory();
    formBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawForm() {
    const u = selected;
    const amount = h('input', { type: 'number', min: 1, step: 1, placeholder: 'Jumlah koin' });
    const note = h('input', { type: 'text', placeholder: 'Catatan (opsional), mis. Top up transfer bank', maxlength: 200 });
    const mode = h('select', {}, h('option', { value: 'add' }, 'Tambah koin'), h('option', { value: 'sub' }, 'Kurangi koin'));
    const chips = h('div', { class: 'row wrap', style: 'gap:6px;margin-bottom:12px' }, [1000, 5000, 10000, 50000, 100000, 500000].map((n) =>
      h('button', { type: 'button', class: 'tab', onclick: () => { amount.value = n; } }, fmt(n))));
    const balance = h('b', {}, fmt(u.coins) + ' koin');
    const submit = h('button', { class: 'btn pri', type: 'submit' }, 'Kirim koin');

    formBox.replaceChildren(h('form', { class: 'card', style: 'max-width:520px;margin-bottom:6px', onsubmit: async (e) => {
      e.preventDefault();
      const n = Math.trunc(Number(amount.value));
      if (!(n > 0)) return toast('Isi jumlah koin lebih dari 0', true);
      const sign = mode.value === 'sub' ? -1 : 1;
      const ok = await confirmModal(sign > 0 ? 'Kirim koin' : 'Kurangi koin',
        (sign > 0 ? 'Kirim ' : 'Kurangi ') + fmt(n) + ' koin ' + (sign > 0 ? 'ke ' : 'dari ') + u.displayName + ' (@' + u.username + ')?', sign > 0 ? 'Kirim' : 'Kurangi');
      if (!ok) return;
      submit.disabled = true;
      const r = await act(() => post('/api/admin/users/' + u.id + '/coins', { amount: sign * n, note: note.value.trim() || undefined }));
      submit.disabled = false;
      if (!r) return;
      u.coins = r.coins;
      balance.textContent = fmt(r.coins) + ' koin';
      amount.value = '';
      note.value = '';
      toast((sign > 0 ? 'Koin terkirim. ' : 'Koin dikurangi. ') + 'Saldo sekarang ' + fmt(r.coins));
      drawHistory();
    } },
      h('div', { class: 'row', style: 'margin-bottom:14px' },
        avatar(u.avatarUrl, u.displayName),
        h('div', { class: 'sp', style: 'min-width:0' }, h('b', {}, u.displayName), h('div', { class: 'dim' }, '@' + u.username + ' · ID ' + u.id)),
        h('div', { style: 'text-align:right' }, h('div', { class: 'dim' }, 'Saldo'), balance)),
      h('label', { class: 'f' }, h('span', {}, 'Jenis'), mode),
      h('label', { class: 'f' }, h('span', {}, 'Jumlah'), amount),
      chips,
      h('label', { class: 'f' }, h('span', {}, 'Catatan'), note),
      submit));
    amount.focus();
  }

  async function drawHistory() {
    const list = await act(() => get('/api/admin/coin-log' + (selected ? '?userId=' + selected.id : '')));
    if (!list) return;
    historyBox.replaceChildren(
      h('div', { class: 'sec' }, selected ? 'Riwayat ' + selected.displayName : 'Riwayat top up terbaru'),
      list.length
        ? h('div', { class: 'card', style: 'padding:6px 16px' }, list.map((r) =>
            h('div', { class: 'row', style: 'padding:10px 0;border-bottom:1px solid var(--border)' },
              h('div', { class: 'sp', style: 'min-width:0' },
                h('b', {}, r.displayName), h('span', { class: 'dim' }, ' @' + r.username),
                h('div', { class: 'dim' }, ago(r.createdAt) + (r.admin ? ' · oleh ' + r.admin : '') + (r.note ? ' · ' + r.note : ''))),
              h('div', { style: 'text-align:right' },
                h('b', { style: 'color:' + (r.amount > 0 ? '#15803d' : '#b91c1c') }, (r.amount > 0 ? '+' : '') + fmt(r.amount)),
                h('div', { class: 'dim' }, 'saldo ' + fmt(r.balanceAfter))))))
        : empty('Belum ada riwayat'));
  }

  if (param && /^\d+$/.test(param)) await doSearch(param);
  else await drawHistory();
  return root;
}

// ----- Laporan pengguna -----
let rpTab = 'pending';
async function pageReports() {
  const list = await get('/api/admin/reports?status=' + rpTab);
  const root = h('div');
  root.append(
    ...pageHead('Laporan pengguna', 'Tinjau laporan dan bukti chat. Tangguhkan akun jika terbukti melanggar.'),
    h('div', { class: 'tabs' }, [['pending', 'Menunggu'], ['resolved', 'Ditangani'], ['dismissed', 'Diabaikan']].map(([k, l]) =>
      h('button', { class: 'tab' + (rpTab === k ? ' on' : ''), onclick: () => { rpTab = k; render(); } }, l)))
  );
  if (!list.length) root.append(empty('Tidak ada laporan'));

  const person = (u, label) => h('div', { class: 'row', style: 'min-width:0' },
    avatar(u.avatarUrl, u.displayName, 38),
    h('div', { style: 'min-width:0' }, h('div', { class: 'dim' }, label), h('b', {}, u.displayName), h('div', { class: 'dim' }, '@' + u.username + ' · ID ' + u.id)));

  const grid = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(340px,1fr))' });
  for (const r of list) {
    const t = r.target;
    const heavy = t.reporters >= 3;
    const evidence = r.evidence && r.evidence.length
      ? h('details', { style: 'margin:10px 0' },
          h('summary', { style: 'cursor:pointer;font-weight:700;color:var(--primary-dark)' }, 'Bukti chat (' + r.evidence.length + ' pesan terakhir)'),
          h('div', { class: 'chatlog' }, r.evidence.map((m) =>
            h('div', { class: 'msg ' + m.from },
              h('b', {}, m.from === 'pelapor' ? 'Pelapor' : m.from === 'terlapor' ? 'Terlapor' : 'Sistem'),
              ': ', m.type === 'gift' ? '🎁 ' : '', m.body || '', ' ', h('span', { class: 'dim' }, ago(m.at))))))
      : h('div', { class: 'dim', style: 'margin:8px 0' }, 'Tanpa bukti chat (dilaporkan dari profil).');

    grid.append(h('div', { class: 'card' },
      h('div', { class: 'row wrap', style: 'gap:6px;margin-bottom:10px' },
        h('span', { class: 'pill red' }, r.reasonLabel),
        t.status === 'suspended' ? h('span', { class: 'pill red' }, 'Akun ditangguhkan') : null,
        heavy ? h('span', { class: 'pill amber' }, '⚠ ' + t.reporters + ' pelapor berbeda') : null,
        h('span', { class: 'sp' }),
        h('span', { class: 'dim' }, ago(r.createdAt))),
      person(t, 'Terlapor (' + t.role + ')'),
      h('div', { class: 'dim', style: 'margin:6px 0 10px' }, 'Total dilaporkan ' + t.totalReports + 'x oleh ' + t.reporters + ' orang · diblokir ' + t.blockedBy + ' orang'),
      person(r.reporter, 'Pelapor'),
      r.details ? h('div', { class: 'quote' }, '“' + r.details + '”') : null,
      evidence,
      r.status === 'pending'
        ? h('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' },
            h('button', { class: 'btn sm', onclick: () => review(r, 'dismiss') }, 'Abaikan'),
            h('button', { class: 'btn sm ok', onclick: () => review(r, 'resolve') }, 'Tandai selesai'),
            t.status === 'suspended' ? null : h('button', { class: 'btn sm bad', onclick: () => review(r, 'suspend') }, 'Tangguhkan akun'),
            h('a', { class: 'btn sm', href: '#pengguna/' + t.id, style: 'text-decoration:none' }, 'Lihat pengguna'))
        : h('div', { class: 'dim' }, (r.action === 'suspend' ? 'Akun ditangguhkan' : r.action === 'resolve' ? 'Ditandai selesai' : 'Diabaikan') + (r.adminNote ? ' · ' + r.adminNote : ''))));
  }
  root.append(grid);

  async function review(r, decision) {
    const labels = { dismiss: 'Abaikan laporan', resolve: 'Tandai selesai', suspend: 'Tangguhkan akun ' + r.target.displayName };
    const f = await formModal({
      title: labels[decision],
      submit: decision === 'suspend' ? 'Tangguhkan' : 'Simpan',
      danger: decision === 'suspend',
      fields: [{ name: 'note', label: 'Catatan (opsional, hanya untuk admin)', type: 'textarea',
        hint: decision === 'suspend' ? 'Akun langsung keluar dan tidak bisa masuk lagi. Laporan lain terhadap akun ini ikut selesai.' : null }],
    });
    if (f && await act(() => post('/api/admin/reports/' + r.id + '/review', { decision, note: f.note || undefined }), 'Laporan diperbarui')) render();
  }
  return root;
}

// ----- Penarikan diamond host -----
let wdTab = 'pending';
const rupiah = (n) => 'Rp ' + fmt(n);
// Jumlah dalam satuan terkecil: Rupiah utuh (IDR) atau sen (USD)
const money = (cur, n) => (cur === 'USD' ? '$' + (n / 100).toFixed(2) + ' USDT' : rupiah(n));

function copyText(text, label) {
  const done = () => toast((label || 'Teks') + ' disalin');
  const fail = () => toast('Salin manual: ' + text, true);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
  else fail();
}

async function pageWithdrawals() {
  const list = await get('/api/admin/withdrawals?status=' + wdTab);
  const root = h('div');
  root.append(
    ...pageHead('Penarikan diamond', 'Transfer manual ke rekening host, lalu tandai sudah dibayar. Jika ditolak, diamond otomatis dikembalikan ke host.'),
    h('div', { class: 'tabs' }, [['pending', 'Menunggu'], ['paid', 'Dibayar'], ['rejected', 'Ditolak'], ['cancelled', 'Dibatalkan']].map(([k, l]) =>
      h('button', { class: 'tab' + (wdTab === k ? ' on' : ''), onclick: () => { wdTab = k; render(); } }, l)))
  );
  if (wdTab === 'pending' && list.length) {
    const sum = (cur) => list.filter((w) => w.currency === cur).reduce((a, w) => a + w.net, 0);
    const parts = [sum('IDR') ? rupiah(sum('IDR')) : null, sum('USD') ? money('USD', sum('USD')) : null].filter(Boolean);
    root.append(h('div', { class: 'card stat warn', style: 'margin-bottom:14px' },
      h('div', { class: 'n' }, parts.join(' + ')),
      h('div', { class: 'l' }, list.length + ' pengajuan menunggu — total yang perlu ditransfer')));
  }
  if (!list.length) root.append(empty('Tidak ada penarikan'));

  const row = (k, v, copy) => h('div', { class: 'row', style: 'justify-content:space-between;gap:8px;padding:4px 0' },
    h('span', { class: 'muted' }, k),
    h('span', { class: 'row', style: 'gap:6px' }, h('b', {}, v), copy ? h('button', { class: 'btn sm', onclick: () => copyText(copy, k) }, 'Salin') : null));

  const grid = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(340px,1fr))' });
  for (const w of list) {
    grid.append(h('div', { class: 'card' },
      h('div', { class: 'row', style: 'margin-bottom:10px' },
        avatar(w.user.avatarUrl, w.user.displayName),
        h('div', { class: 'sp', style: 'min-width:0' }, h('b', {}, w.user.displayName), h('div', { class: 'dim' }, (w.owner === 'agency' ? 'AGENCY · ' : 'ID ' + w.user.id + ' · ') + ago(w.createdAt))),
        w.status !== 'pending' ? h('span', { class: 'pill ' + (w.status === 'paid' ? 'green' : 'red') }, { paid: 'Dibayar', rejected: 'Ditolak', cancelled: 'Dibatalkan' }[w.status]) : null),
      h('div', { class: 'quote', style: 'font-style:normal;background:#f5f3ff;border-color:var(--primary)' },
        h('div', { class: 'dim' }, w.owner === 'agency' ? 'Transfer ke agency (komisi)' : 'Transfer ke host'),
        h('div', { style: 'font-size:26px;font-weight:900;letter-spacing:-.5px' }, money(w.currency, w.net)),
        h('div', { class: 'dim' }, fmt(w.diamonds) + ' diamond ÷ ' + fmt(w.diamondsPerUsd) + ' = $' + (w.diamonds / w.diamondsPerUsd).toFixed(2)
          + (w.currency === 'IDR' ? ' × Rp ' + fmt(w.usdIdr) + ' = ' + rupiah(w.gross) : '')
          + (w.fee ? ' − biaya ' + (w.currency === 'USD' ? '$' + (w.fee / 100).toFixed(2) : rupiah(w.fee)) : ''))),
      h('div', { style: 'margin:8px 0' },
        w.kind === 'crypto'
          ? [row('Jaringan', 'USDT · TRC20 (Tron)'),
             h('div', { class: 'quote', style: 'font-style:normal;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;margin:6px 0' }, w.accountNumber),
             row('Alamat dompet', 'Salin alamat', w.accountNumber),
             w.status === 'pending' ? h('div', { class: 'warn-text' }, 'Periksa jaringan TRC20 sebelum mengirim. Kiriman ke jaringan lain tidak bisa ditarik kembali.') : null]
          : [row(w.kind === 'bank' ? 'Bank' : 'E-wallet', w.provider),
             row('Nomor', w.accountNumber, w.accountNumber),
             row('Atas nama', w.accountName, w.accountName)],
        row(w.owner === 'agency' ? 'Negara agency' : 'Negara host', w.user.countryCode || '-'),
        w.paidBefore ? row('Sudah dibayar sebelumnya', money(w.currency, w.paidBefore)) : null),
      w.status === 'pending'
        ? h('div', { class: 'row wrap', style: 'gap:6px;margin-top:10px' },
            h('button', { class: 'btn ok sp', onclick: () => pay(w) }, 'Tandai sudah dibayar'),
            h('button', { class: 'btn bad', onclick: () => reject(w) }, 'Tolak'))
        : h('div', { class: 'dim', style: 'margin-top:6px' },
            (w.transferRef ? 'Ref: ' + w.transferRef + ' · ' : '') + (w.adminNote || '') + (w.reviewedAt ? ' · ' + ago(w.reviewedAt) : ''))));
  }
  root.append(grid);

  async function pay(w) {
    const f = await formModal({
      title: 'Tandai sudah dibayar',
      submit: 'Sudah ditransfer',
      fields: [
        { name: 'ref', label: w.currency === 'USD' ? 'Hash transaksi / TXID (opsional)' : 'Nomor referensi transfer (opsional)', type: 'text', hint: w.currency === 'USD' ? 'Dari Tronscan atau dompetmu, untuk pembukuan' : 'Dari bukti transfer, untuk pembukuan' },
        { name: 'note', label: 'Catatan (opsional)', type: 'textarea' },
      ],
    });
    if (f && await act(() => post('/api/admin/' + (w.owner === 'agency' ? 'agency-withdrawals/' : 'withdrawals/') + w.id + '/pay', { ref: f.ref || undefined, note: f.note || undefined }), 'Ditandai sudah dibayar')) render();
  }

  async function reject(w) {
    const f = await formModal({
      title: 'Tolak penarikan',
      submit: w.owner === 'agency' ? 'Tolak & kembalikan saldo' : 'Tolak & kembalikan diamond',
      danger: true,
      fields: [{ name: 'reason', label: 'Alasan (dilihat host)', type: 'textarea', hint: 'Mis. nama rekening tidak cocok dengan nama akun, atau alamat dompet tidak bisa dipakai' }],
    });
    if (f && await act(() => post('/api/admin/' + (w.owner === 'agency' ? 'agency-withdrawals/' : 'withdrawals/') + w.id + '/reject', { reason: f.reason }), 'Ditolak, diamond dikembalikan')) render();
  }
  return root;
}

// ----- Paket koin (layar Top up di aplikasi) -----
async function pagePackages() {
  const [list, settings, margin] = await Promise.all([get('/api/admin/packages'), get('/api/admin/settings'), get('/api/admin/margin')]);
  const root = h('div', {}, pageHead('Paket koin', 'Daftar yang tampil di layar Top up aplikasi. Pemesanan lewat WhatsApp admin; koin ditambahkan manual di menu Top up koin setelah pembayaran masuk.'));

  root.append(marginCard(margin));

  // --- Kontak & catatan pembayaran ---
  const wa = h('input', { type: 'text', value: settings.topup_contact || '', placeholder: 'mis. 081234567890 atau +14155550100', inputmode: 'tel' });
  const note = h('textarea', { rows: 3, maxlength: 500, value: settings.topup_note || '' });
  root.append(h('form', { class: 'card', style: 'max-width:620px;margin-bottom:18px', onsubmit: async (e) => {
    e.preventDefault();
    if (await act(() => patch('/api/admin/settings', { topup_contact: wa.value.trim(), topup_note: note.value }), 'Kontak top up disimpan')) render();
  } },
    h('b', {}, 'Kontak pemesanan'),
    h('label', { class: 'f', style: 'margin-top:10px' }, h('span', {}, 'Nomor WhatsApp admin'), wa,
      h('small', { class: 'hint' }, 'Mengetuk sebuah paket di aplikasi membuka chat WhatsApp ke nomor ini, dengan pesan berisi paket dan ID akun pengguna. Awalan 08 otomatis diubah menjadi 628. Untuk nomor luar negeri tulis dengan kode negara.')),
    h('label', { class: 'f' }, h('span', {}, 'Catatan pembayaran (tampil di layar Top up)'), note,
      h('small', { class: 'hint' }, 'Mis. cara bayar yang diterima (transfer bank, e-wallet, QRIS, USDT) dan batas waktu konfirmasi.')),
    settings.topup_contact ? null : h('div', { class: 'warn-text', style: 'margin-bottom:10px' }, 'Nomor WhatsApp belum diisi: pengguna belum bisa memesan.'),
    h('button', { class: 'btn pri', type: 'submit' }, 'Simpan')));

  // --- Paket ---
  const fields = (pk) => [
    { name: 'coins', label: 'Jumlah koin', type: 'number', value: pk ? pk.coins : '', hint: 'Contoh: 18000' },
    { name: 'auto', label: 'Hitung harga otomatis dari harga jual per koin (Pengaturan)', type: 'checkbox', value: !pk,
      hint: null },
    { name: 'priceIdr', label: 'Harga Rupiah (Indonesia)', type: 'number', value: pk ? pk.priceIdr : '', hint: 'Diabaikan jika hitung otomatis dicentang' },
    { name: 'priceUsd', label: 'Harga USD (negara lain)', type: 'number', value: pk ? +(pk.priceUsdCents / 100).toFixed(2) : '', hint: 'Dalam dolar, mis. 2.70' },
    { name: 'badge', label: 'Label (opsional)', value: pk ? pk.badge || '' : '', hint: 'Mis. Populer, Hemat. Maks 20 karakter.' },
    { name: 'sortOrder', label: 'Urutan', type: 'number', value: pk ? pk.sortOrder : list.length + 1, hint: 'Angka kecil tampil lebih dulu' },
    { name: 'active', label: 'Aktif (tampil di aplikasi)', type: 'checkbox', value: pk ? pk.active : true },
  ];
  const coinPrice = Number(settings.coin_price_idr); // Rupiah per koin
  const usdIdr = Number(settings.withdraw_usd_idr);
  const body = (r) => {
    const coins = Math.trunc(r.coins || 0);
    let priceIdr = r.priceIdr;
    let usdCents = r.priceUsd === null ? null : Math.round(r.priceUsd * 100);
    if (r.auto) {
      // Harga jual per koin (Pengaturan); Rupiah dibulatkan ke 100 terdekat, USD dari kurs Rupiah/USD
      priceIdr = Math.round((coins * coinPrice) / 100) * 100;
      usdCents = Math.round(((coins * coinPrice) / usdIdr) * 100);
    }
    return { coins, priceIdr, priceUsdCents: usdCents, badge: r.badge || '', sortOrder: r.sortOrder ?? 0, active: r.active };
  };

  root.append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn pri', onclick: async () => {
    const r = await formModal({ title: 'Paket koin baru', fields: fields(null), submit: 'Buat' });
    if (r && await act(() => post('/api/admin/packages', body(r)), 'Paket dibuat')) render();
  } }, '+ Paket baru')));
  if (!list.length) root.append(empty('Belum ada paket'));

  const grid = h('div', { class: 'grid g2' });
  for (const pk of list) {
    const perCoin = (pk.priceIdr / pk.coins).toFixed(2).replace('.', ',');
    grid.append(h('div', { class: 'card', style: pk.active ? '' : 'opacity:.6' },
      h('div', { class: 'row' },
        h('div', { class: 'sp' },
          h('div', { style: 'font-size:24px;font-weight:900;letter-spacing:-.5px' }, '🪙 ' + fmt(pk.coins) + ' koin'),
          h('div', { class: 'dim' }, 'Rp ' + perCoin + ' per koin · urutan ' + pk.sortOrder)),
        h('div', { style: 'text-align:right' },
          pk.badge ? h('span', { class: 'pill amber' }, pk.badge) : null,
          pk.active ? null : h('div', { style: 'margin-top:4px' }, h('span', { class: 'pill red' }, 'Nonaktif')))),
      h('dl', { class: 'kv', style: 'margin-top:10px' },
        h('dt', {}, 'Harga Rupiah'), h('dd', {}, 'Rp ' + fmt(pk.priceIdr)),
        h('dt', {}, 'Harga USD'), h('dd', {}, '$' + (pk.priceUsdCents / 100).toFixed(2))),
      h('div', { class: 'row wrap', style: 'margin-top:12px;gap:6px' },
        h('button', { class: 'btn sm', onclick: async () => {
          const r = await formModal({ title: 'Ubah paket', fields: fields(pk) });
          if (r && await act(() => patch('/api/admin/packages/' + pk.id, body(r)), 'Paket diperbarui')) render();
        } }, 'Ubah'),
        h('button', { class: 'btn sm', onclick: async () => {
          if (await act(() => patch('/api/admin/packages/' + pk.id, { active: !pk.active }), pk.active ? 'Paket disembunyikan' : 'Paket ditampilkan')) render();
        } }, pk.active ? 'Sembunyikan' : 'Tampilkan'),
        h('button', { class: 'btn sm bad', onclick: async () => {
          if (await confirmModal('Hapus paket', fmt(pk.coins) + ' koin akan dihapus dari daftar.', 'Hapus')
            && await act(() => api('DELETE', '/api/admin/packages/' + pk.id), 'Paket dihapus')) render();
        } }, 'Hapus'))));
  }
  root.append(grid);
  return root;
}

// ----- Gift -----
function giftIcon(g) {
  return h('div', { class: 'gift-ic' }, g.imageUrl ? h('img', { src: g.imageUrl, alt: '' }) : (g.icon || '🎁'));
}

async function pageGifts() {
  const list = await get('/api/admin/gifts');
  const root = h('div', {}, pageHead('Gift', 'Kelola gift yang bisa dikirim pengguna. Gift kategori "mewah" tampil dengan animasi layar penuh.'));

  const fields = (g) => [
    { name: 'name', label: 'Nama', value: g && g.name },
    { name: 'price', label: 'Harga (koin)', type: 'number', value: g ? g.price : '' },
    { name: 'icon', label: 'Ikon emoji', value: g ? g.icon : '🎁', hint: 'Dipakai jika tidak ada gambar' },
    { name: 'category', label: 'Kategori', type: 'select', value: g ? g.category : 'normal', options: [{ value: 'normal', label: 'Populer' }, { value: 'luxury', label: 'Mewah (animasi layar penuh)' }] },
    { name: 'hostMultiplier', label: 'Pengali bagian host', type: 'select', value: g ? String(g.hostMultiplier) : '1', options: [{ value: '1', label: 'x1 (normal, host 10%)' }, { value: '2', label: 'x2 (host 20%)' }, { value: '3', label: 'x3 (host 30%)' }], hint: 'Gift bertanda x2: host menerima dua kali bagian normal. Server menolak jika membuat app rugi.' },
    { name: 'sortOrder', label: 'Urutan', type: 'number', value: g ? g.sortOrder : 0, hint: 'Angka kecil tampil lebih dulu' },
    { name: 'image', label: 'Gambar gift (opsional)', type: 'file', maxMB: 5, preview: 'image', current: g && g.imageUrl, hint: 'PNG/WEBP transparan, maks 5 MB. Menggantikan emoji.' },
    ...(g && g.imageUrl ? [{ name: 'removeImage', label: 'Hapus gambar yang ada', type: 'checkbox', value: false }] : []),
    { name: 'video', label: 'Efek MP4 layar penuh (opsional)', type: 'file', accept: 'video/mp4', maxMB: 15, preview: 'video', current: g && g.animationUrl, hint: 'MP4 maks 15 MB, disarankan portrait (mis. 720x1280) dan H.264. Diputar maksimal 6 detik lalu memudar halus. Suara tidak diputar.' },
    ...(g && g.animationUrl ? [{ name: 'removeVideo', label: 'Hapus efek MP4 yang ada', type: 'checkbox', value: false }] : []),
    { name: 'sound', label: 'Suara gift (opsional)', type: 'file', accept: 'audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav', maxMB: 2, preview: 'audio', current: g && g.soundUrl, hint: 'MP3/M4A/AAC/OGG/WAV maks 2 MB, sebaiknya 1–4 detik. Diputar di HP penerima dan pengirim saat gift datang.' },
    ...(g && g.soundUrl ? [{ name: 'removeSound', label: 'Hapus suara yang ada', type: 'checkbox', value: false }] : []),
    { name: 'blend', label: 'Latar video hitam → jadikan transparan', type: 'checkbox', value: g ? g.animationBlend : false },
    { name: 'autoThumb', label: 'Buat gambar gift otomatis dari video (jika gambar kosong)', type: 'checkbox', value: true },
    { name: 'active', label: 'Aktif (tampil di panel gift)', type: 'checkbox', value: g ? g.active : true },
  ];

  // Unggah file (dengan kemajuan) lalu simpan gift
  const save = async (g, r, ui) => {
    let imageUrl;
    if (r.image) {
      ui.progress('Mengunggah gambar…', 0);
      imageUrl = (await xhrUpload('/api/admin/upload', r.image, (p) => ui.progress('Mengunggah gambar… ' + Math.round(p * 100) + '%', p))).url;
    } else if (r.removeImage) imageUrl = '';
    let animationUrl;
    if (r.video) {
      ui.progress('Mengunggah efek MP4…', 0);
      animationUrl = (await xhrUpload('/api/admin/upload-video', r.video, (p) => ui.progress('Mengunggah efek MP4… ' + Math.round(p * 100) + '%', p))).url;
    } else if (r.removeVideo) animationUrl = '';
    let soundUrl;
    if (r.sound) {
      ui.progress('Mengunggah suara…', 0);
      soundUrl = (await xhrUpload('/api/admin/upload-audio', r.sound, (p) => ui.progress('Mengunggah suara… ' + Math.round(p * 100) + '%', p))).url;
    } else if (r.removeSound) soundUrl = '';
    // Tidak ada gambar tapi ada video: ambil gambar dari video supaya daftar gift & chat tidak hanya emoji
    const hasImage = r.image || (g && g.imageUrl && !r.removeImage);
    if (r.video && r.autoThumb && !hasImage && imageUrl === undefined) {
      ui.progress('Membuat gambar dari video…', 0);
      const thumb = await makeThumb(URL.createObjectURL(r.video), r.blend);
      imageUrl = (await xhrUpload('/api/admin/upload', thumb, (p) => ui.progress('Mengunggah gambar… ' + Math.round(p * 100) + '%', p))).url;
    }
    ui.progress('Menyimpan…', 1);
    const body = { name: r.name, price: r.price, icon: r.icon || undefined, hostMultiplier: Number(r.hostMultiplier) || 1, category: r.category, sortOrder: r.sortOrder ?? 0, active: r.active, animationBlend: r.blend };
    if (imageUrl !== undefined) body.imageUrl = imageUrl;
    if (animationUrl !== undefined) body.animationUrl = animationUrl;
    if (soundUrl !== undefined) body.soundUrl = soundUrl;
    return g ? patch('/api/admin/gifts/' + g.id, body) : post('/api/admin/gifts', body);
  };

  root.append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn pri', onclick: async () => {
    const r = await formModal({ title: 'Gift baru', fields: fields(null), submit: 'Buat', onSubmit: (v, ui) => save(null, v, ui) });
    if (r) {
      toast('Gift dibuat');
      render();
    }
  } }, '+ Gift baru')));
  if (!list.length) root.append(empty('Belum ada gift'));
  const grid = h('div', { class: 'grid g2' });
  for (const g of list) {
    grid.append(h('div', { class: 'card', style: g.active ? '' : 'opacity:.6' },
      h('div', { class: 'row' },
        giftIcon(g),
        h('div', { class: 'sp' }, h('b', {}, g.name), h('div', { class: 'dim' }, fmt(g.price) + ' koin · urutan ' + g.sortOrder)),
        h('div', { style: 'text-align:right' },
          h('span', { class: 'pill ' + (g.category === 'luxury' ? 'amber' : '') }, g.category === 'luxury' ? 'Mewah' : 'Populer'), g.hostMultiplier > 1 ? h('span', { class: 'pill green', style: 'margin-left:4px' }, 'host x' + g.hostMultiplier) : null,
          h('div', { style: 'margin-top:4px' }, g.active ? null : h('span', { class: 'pill red' }, 'Nonaktif'), g.animationUrl ? h('span', { class: 'pill purple', style: 'margin-left:4px' }, '🎬 MP4') : null, g.soundUrl ? h('span', { class: 'pill', style: 'margin-left:4px' }, '🔊') : null, g.animationUrl && !g.imageUrl ? h('span', { class: 'pill amber', style: 'margin-left:4px' }, 'tanpa gambar') : null))),
      h('div', { class: 'row wrap', style: 'margin-top:12px;gap:6px' }, h('button', { class: 'btn sm', onclick: async () => {
        const r = await formModal({ title: 'Ubah gift', fields: fields(g), onSubmit: (v, ui) => save(g, v, ui) });
        if (r) {
          toast('Gift diperbarui');
          render();
        }
      } }, 'Ubah'),
      g.animationUrl ? h('button', { class: 'btn sm', onclick: () => lightboxVideo(g.animationUrl) }, '▶ Putar efek MP4') : null,
      g.animationUrl && !g.imageUrl ? h('button', { class: 'btn sm pri', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Membuat gambar…';
        try {
          const file = await makeThumb(g.animationUrl, g.animationBlend);
          const up = await xhrUpload('/api/admin/upload', file, () => {});
          await patch('/api/admin/gifts/' + g.id, { imageUrl: up.url });
          toast('Gambar gift dibuat dari video');
          render();
        } catch (ex) {
          toast(ex.message, true);
          btn.disabled = false;
          btn.textContent = '🖼 Buat gambar dari video';
        }
      } }, '🖼 Buat gambar dari video') : null)));
  }
  root.append(grid);
  return root;
}

// ----- Pengaturan -----
async function pageSettings() {
  const [s, margin] = await Promise.all([get('/api/admin/settings'), get('/api/admin/margin')]);
  const root = h('div', {}, pageHead('Pengaturan', 'Berlaku langsung untuk semua pengguna.'));
  root.append(marginCard(margin));
  const defs = [
    { k: 'gift_host_share', label: 'Bagian host dari gift (%)', hint: 'Host menerima persen ini dari harga gift (gift bertanda x2 = dua kalinya, diatur di halaman Gift). 10 = harga 1 juta koin → 100 ribu koin ke host.', conv: (v) => v * 100, back: (v) => v / 100, min: 0, max: 100 },
    { k: 'host_share', label: 'Bagian host dari pesan chat (%)', hint: 'Host menerima persen ini dari tiap koin pesan berbayar. Komisi agency (per agency) dibayar dari bagian app, bukan dari host.', conv: (v) => v * 100, back: (v) => v / 100, min: 0, max: 100 },
    { k: 'chat_price_min', label: 'Harga pesan minimum (koin)', min: 0 },
    { k: 'chat_price_max', label: 'Harga pesan maksimum (koin)', min: 0 },
    { k: 'wa_threshold_min', label: 'Syarat total gift untuk buka WA — minimum (koin)', min: 0 },
    { k: 'wa_threshold_max', label: 'Syarat total gift untuk buka WA — maksimum (koin)', min: 0 },
    { k: 'reply_window_hours', label: 'Batas balas sebelum koin dikembalikan (jam)', min: 1 },
    { k: 'coin_price_idr', label: 'Harga jual 1 koin (Rupiah)', hint: 'Dipakai untuk menghitung harga otomatis paket koin. Tidak mengubah paket yang sudah ada.', min: 0.01 },
    { k: 'withdraw_diamonds_per_usd', label: 'Penarikan: diamond per 1 USD', hint: 'Makin besar angkanya, makin kecil nilai 1 diamond (Rp 17.000 ÷ angka ini). Awal 6.667 = Rp 2,55 per diamond. Server menolak nilai yang membuat app rugi.', min: 1 },
    { k: 'withdraw_usd_idr', label: 'Penarikan: Rupiah per 1 USD (host Indonesia)', hint: 'Host Indonesia dibayar Rupiah memakai kurs ini; host negara lain dibayar USDT.', min: 1000 },
    { k: 'level_thresholds', list: true, label: 'Batas level (total top up, koin)', hint: '11 angka dipisah koma untuk Level 0 sampai 10 (Level 0 = 0). Level naik dari TOTAL top up koin.' },
    { k: 'checkin_rewards', list: true, label: 'Hadiah check-in harian (hari 1 sampai 7)', hint: '7 hadiah dipisah koma. coins:10 = 10 koin; cards:5 = 5 pesan gratis (host dibayar app); frame:1:3 = bingkai avatar model 1 selama 3 hari. Semua dibiayai app, jadi buat kecil. Lewat satu hari: mulai lagi dari hari 1.' },
    { k: 'host_level_thresholds', list: true, label: 'Batas level host (penghasilan 7 hari terakhir, diamond)', hint: '11 angka dipisah koma untuk Level 0 sampai 10. Level host dihitung dari total penghasilan diamond 7 hari terakhir (bergulir, bisa naik dan turun).' },
    { k: 'vip_thresholds', list: true, label: 'Batas VIP (total top up, koin)', hint: '5 angka dipisah koma untuk VIP 1 sampai 5. VIP bisa kirim foto/video dan memakai kartu pesan gratis.' },
    { k: 'free_cards_per_day', label: 'Kartu pesan gratis per hari (VIP)', hint: 'Pengguna VIP mengirim pesan ke host berbayar tanpa dipotong koin sebanyak ini per hari.', min: 0, max: 100 },
    { k: 'vip_media_per_day', label: 'Foto/video VIP per hari', hint: 'Batas kiriman foto + video di chat per pengguna VIP per hari.', min: 0, max: 1000 },
    { k: 'host_media_price_max', label: 'Foto/video privat host: harga buka maksimum (koin)', hint: 'Host menentukan harga buka tiap foto/video privat, tidak boleh melebihi ini.', min: 0 },
    { k: 'host_media_per_day', label: 'Foto/video privat host: batas kirim per hari', min: 0, max: 1000 },
    { k: 'host_video_max_seconds', label: 'Video privat: panjang maksimum (detik)', hint: '300 = 5 menit.', min: 10, max: 3600 },
    { k: 'free_card_host_diamonds', label: 'Diamond host per pesan gratis', hint: 'Dibayar oleh app (bukan pengguna). Awal 5 diamond.', min: 0, max: 1000 },
    { k: 'task_reward_moment', label: 'Tugas host: hadiah posting momen (diamond)', hint: 'Tugas pemula, sekali. Diamond host bisa ditarik jadi uang, jadi atur dengan hati-hati.', min: 0, max: 10000 },
    { k: 'task_reward_photos', label: 'Tugas host: hadiah 3 foto album (diamond)', hint: 'Tugas pemula, sekali.', min: 0, max: 10000 },
    { k: 'task_reward_checkin', label: 'Tugas host: hadiah check-in harian (diamond)', min: 0, max: 10000 },
    { k: 'task_reward_like', label: 'Tugas host: hadiah menyukai pengguna (diamond)', hint: 'Harian: dapat jika host menyukai target pengguna dalam sehari.', min: 0, max: 10000 },
    { k: 'task_like_target', label: 'Tugas host: target pengguna yang disukai per hari', min: 1, max: 500 },
    { k: 'withdraw_min_diamonds', label: 'Penarikan: minimal diamond per pengajuan', min: 1 },
    { k: 'withdraw_fee_percent', label: 'Penarikan: biaya (%)', hint: 'Dipotong dari jumlah penarikan. 0 = tanpa biaya.', min: 0, max: 50 },
    { k: 'withdraw_usdt_fee_usd', label: 'Penarikan USDT: biaya jaringan TRC20 (USD)', hint: 'Dipotong dari tiap penarikan USDT untuk menutup biaya kirim di jaringan Tron.', min: 0, max: 50 },
  ];
  const inputs = {};
  const form = h('form', { class: 'card', style: 'max-width:520px', onsubmit: async (e) => {
    e.preventDefault();
    const body = {};
    for (const d of defs) {
      if (d.list) { body[d.k] = inputs[d.k].value; continue; }
      const raw = Number(inputs[d.k].value);
      if (!Number.isFinite(raw)) return toast(d.label + ' harus angka', true);
      body[d.k] = d.back ? d.back(raw) : raw;
    }
    if (await act(() => patch('/api/admin/settings', body), 'Pengaturan disimpan')) render();
  } },
    defs.map((d) => {
      const input = d.list
        ? h('input', { type: 'text', value: (s[d.k] || []).join(', ') })
        : h('input', { type: 'number', step: 'any', min: d.min, max: d.max, value: d.conv ? d.conv(Number(s[d.k])) : s[d.k] });
      inputs[d.k] = input;
      return h('label', { class: 'f' }, h('span', {}, d.label), input, d.hint ? h('small', { class: 'hint' }, d.hint) : null);
    }),
    h('button', { class: 'btn pri', type: 'submit' }, 'Simpan'));
  root.append(form);
  return root;
}

// ---------------------------------------------------------------------------
// Router & kerangka
// ---------------------------------------------------------------------------
const pages = {
  dashboard: { title: 'Dashboard', icon: '📊', fn: pageDashboard },
  verifikasi: { title: 'Verifikasi wajah', icon: '🪪', fn: pageVerifikasi, badge: () => stats && stats.pending.verifications },
  foto: { title: 'Foto host', icon: '🖼️', fn: pagePhotos, badge: () => stats && stats.pending.photos + stats.pending.avatars },
  momen: { title: 'Momen host', icon: '📸', fn: pageMoments, badge: () => stats && stats.pending.moments },
  media: { title: 'Media privat', icon: '🔒', fn: pageMedia },
  gaji: { title: 'Gaji pokok host', icon: '🧾', fn: pageSalary },
  pengguna: { title: 'Pengguna', icon: '👥', fn: pageUsers },
  topup: { title: 'Top up koin', icon: '💰', fn: pageTopup },
  paket: { title: 'Paket koin', icon: '🪙', fn: pagePackages },
  penarikan: { title: 'Penarikan', icon: '💸', fn: pageWithdrawals, badge: () => stats && stats.pending.withdrawals },
  laporan: { title: 'Laporan', icon: '🚩', fn: pageReports, badge: () => stats && stats.pending.reports },
  agency: { title: 'Agency', icon: '🏢', fn: pageAgency },
  gift: { title: 'Gift', icon: '🎁', fn: pageGifts },
  pengaturan: { title: 'Pengaturan', icon: '⚙️', fn: pageSettings },
};

async function refreshStats() {
  stats = await get('/api/admin/stats');
  drawNav();
  return stats;
}

function current() {
  const k = location.hash.replace('#', '').split('/')[0];
  return pages[k] ? k : 'dashboard';
}
const hashParam = () => location.hash.replace('#', '').split('/')[1] || '';

function drawNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const cur = current();
  nav.replaceChildren(...Object.entries(pages).map(([k, p]) => {
    const b = p.badge && p.badge();
    return h('a', { href: '#' + k, class: k === cur ? 'on' : '' }, h('span', {}, p.icon + '  ' + p.title), b ? h('span', { class: 'badge' }, b) : null);
  }));
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const k = current();
  drawNav();
  const el = document.getElementById('content');
  if (!el) return;
  document.getElementById('side').classList.remove('open');
  const scrim = document.querySelector('.scrim');
  if (scrim) scrim.remove();
  document.getElementById('toptitle').textContent = pages[k].title;
  try {
    const out = await pages[k].fn(hashParam());
    if (seq !== renderSeq) return;
    el.replaceChildren(...[out].flat(Infinity).filter(Boolean));
    if (k !== 'dashboard') refreshStats().catch(() => {});
  } catch (e) {
    if (seq !== renderSeq) return;
    el.replaceChildren(empty(e.message));
  }
}

function logout() {
  saveSession(null);
  showLogin();
}

function showApp() {
  const app = document.getElementById('app');
  const side = h('aside', { class: 'side', id: 'side' },
    h('div', { class: 'logo' }, h('i'), 'Amora Admin'),
    h('nav', { class: 'nav', id: 'nav' }),
    h('div', { class: 'foot' }, session && session.user ? '@' + session.user.username : '', h('br'),
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); logout(); } }, 'Keluar')));
  const top = h('div', { class: 'top' },
    h('button', { class: 'btn sm', onclick: () => {
      side.classList.toggle('open');
      const old = document.querySelector('.scrim');
      if (old) old.remove();
      else if (side.classList.contains('open')) document.body.append(h('div', { class: 'scrim', onclick: () => { side.classList.remove('open'); document.querySelector('.scrim')?.remove(); } }));
    } }, '☰'),
    h('b', { id: 'toptitle' }, ''));
  app.replaceChildren(h('div', { class: 'shell' }, side, h('div', { style: 'flex:1;min-width:0' }, top, h('main', { class: 'main', id: 'content' }))));
  render();
}

function showLogin(message) {
  const app = document.getElementById('app');
  const err = h('p', { class: 'err-text' }, message || '');
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const btn = h('button', { class: 'btn pri', type: 'submit', style: 'width:100%;padding:12px' }, 'Masuk');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    err.textContent = '';
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: user.value.trim(), password: pass.value }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error && json.error.message) || 'Gagal masuk');
      if (json.user.role !== 'admin') throw new Error('Akun ini bukan admin');
      saveSession({ accessToken: json.accessToken, refreshToken: json.refreshToken, user: json.user });
      showApp();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  } },
    h('label', { class: 'f' }, h('span', {}, 'Username'), user),
    h('label', { class: 'f' }, h('span', {}, 'Password'), pass),
    err, btn);
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' }, h('h1', {}, 'Amora Admin'), h('p', { class: 'lead' }, 'Masuk dengan akun admin'), form)));
  user.focus();
}

window.addEventListener('hashchange', () => { if (session) render(); });

if (session && session.accessToken) {
  // Pastikan sesi masih berlaku & benar-benar admin
  get('/api/me').then((u) => {
    if (u.role !== 'admin') throw new Error('bukan admin');
    showApp();
  }).catch(() => {
    saveSession(null);
    showLogin();
  });
} else {
  showLogin();
}

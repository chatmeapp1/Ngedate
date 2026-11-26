/* Panel agency Amora: login, ringkasan, host, riwayat komisi, penarikan, akun. Tanpa framework. */
'use strict';

const KEY = 'amora.agency.token';
let token = null;
try { token = localStorage.getItem(KEY); } catch (e) { /* penyimpanan diblokir */ }

const $app = document.getElementById('app');

// ---------- Helper ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmt = (n) => Number(n).toLocaleString('id-ID');
const rupiah = (n) => 'Rp ' + fmt(n);
const usd = (cents) => '$' + (cents / 100).toFixed(2);
const money = (cur, n) => (cur === 'IDR' ? rupiah(n) : usd(n));
function ago(iso) {
  if (!iso) return '-';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
function toast(text, err) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, text);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}
async function request(method, path, body) {
  const res = await fetch('/api/agency' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) { signOut(); throw new Error(json?.error?.message || 'Sesi habis, masuk lagi'); }
    throw new Error(json?.error?.message || 'Terjadi kesalahan');
  }
  return json;
}
const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b || {});
const put = (p, b) => request('PUT', p, b || {});
async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r === undefined ? true : r; } catch (e) { toast(e.message, true); return false; }
}
function setToken(t) {
  token = t;
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) { /* abaikan */ }
}
function signOut() { setToken(null); location.hash = ''; renderApp(); }
const empty = (text) => h('div', { class: 'empty' }, text);
const field = (label, input, hint) => h('label', { class: 'f' }, h('span', {}, label), input, hint ? h('small', { class: 'hint' }, hint) : null);

// ---------- Login ----------
function loginView() {
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', placeholder: 'Username agency' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const btn = h('button', { class: 'btn pri', type: 'submit', style: 'width:100%' }, 'Masuk');
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    const r = await act(() => post('/login', { username: user.value.trim(), password: pass.value }));
    btn.disabled = false;
    if (r) { setToken(r.accessToken); location.hash = '#ringkasan'; renderApp(); }
  } },
    h('div', { class: 'logo', style: 'padding:0 0 4px' }, h('i'), 'Amora Agency'),
    h('p', { class: 'muted', style: 'margin:0 0 16px' }, 'Masuk untuk melihat penghasilan dan menarik komisi agency.'),
    field('Username', user), field('Password', pass), btn,
    h('p', { class: 'dim', style: 'margin:14px 0 0;text-align:center' }, 'Belum punya akun? Minta admin Amora membuatkan username dan password untuk agency Anda.'));
  return h('div', { class: 'login' }, form);
}

// ---------- Kerangka ----------
const PAGES = {
  ringkasan: ['Ringkasan', '📊', pageOverview],
  host: ['Host saya', '👩', pageHosts],
  riwayat: ['Riwayat komisi', '🧾', pageEarnings],
  tarik: ['Tarik komisi', '💸', pageWithdraw],
  akun: ['Akun', '⚙️', pageAccount],
};
let menuOpen = false;

function renderApp() {
  if (!token) { $app.replaceChildren(loginView()); return; }
  const key = (location.hash || '#ringkasan').slice(1);
  const page = PAGES[key] || PAGES.ringkasan;
  const nav = h('nav', { class: 'nav' }, Object.entries(PAGES).map(([k, [title, icon]]) =>
    h('a', { href: '#' + k, class: k === (PAGES[key] ? key : 'ringkasan') ? 'on' : '', onclick: () => { menuOpen = false; } }, h('span', {}, icon + '  ' + title))));
  const side = h('aside', { class: 'side' + (menuOpen ? ' open' : '') },
    h('div', { class: 'logo' }, h('i'), 'Agency'), nav,
    h('div', { class: 'foot' }, h('button', { class: 'btn sm', onclick: signOut }, 'Keluar')));
  const content = h('main', { class: 'main' });
  $app.replaceChildren(h('div', { class: 'shell' },
    side, menuOpen ? h('div', { class: 'scrim', onclick: () => { menuOpen = false; renderApp(); } }) : null,
    h('div', { style: 'flex:1;min-width:0' },
      h('div', { class: 'top' }, h('button', { class: 'btn sm', onclick: () => { menuOpen = !menuOpen; renderApp(); } }, '☰'), h('b', {}, page[0])),
      content)));
  content.append(h('div', { class: 'empty' }, 'Memuat…'));
  Promise.resolve(page[2]()).then((el) => content.replaceChildren(el)).catch((e) => content.replaceChildren(empty(e.message)));
}
window.addEventListener('hashchange', () => { menuOpen = false; renderApp(); });

const head = (title, lead) => [h('h1', {}, title), lead ? h('p', { class: 'lead' }, lead) : null];
const stat = (n, l, cls) => h('div', { class: 'card stat' + (cls ? ' ' + cls : '') }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));

// ---------- Ringkasan ----------
async function pageOverview() {
  const o = await get('/overview');
  const root = h('div', {}, head('Halo, ' + o.agency.name, 'Komisi ' + Math.round(o.agency.commissionRate * 100) + '% dari penghasilan setiap host Anda. Kode agency: ' + o.agency.code));
  const est = o.estimate;
  root.append(h('div', { class: 'card', style: 'margin-bottom:14px;background:linear-gradient(135deg,#f3e8ff,#ffe4f1);border-color:#e9d5ff' },
    h('div', { class: 'dim' }, 'Saldo komisi yang bisa ditarik'),
    h('div', { style: 'font-size:34px;font-weight:900;letter-spacing:-1px' }, '💎 ' + fmt(o.balance)),
    est ? h('div', { class: 'muted' }, '≈ ' + money(est.currency, est.gross) + ' sebelum biaya') : h('div', { class: 'muted' }, 'Belum ada saldo'),
    h('div', { style: 'margin-top:10px' }, h('a', { class: 'btn pri', href: '#tarik', style: 'text-decoration:none;display:inline-block' }, 'Tarik komisi'))));
  root.append(h('div', { class: 'grid g3' },
    stat(fmt(o.last24h), 'Komisi 24 jam'), stat(fmt(o.last7d), 'Komisi 7 hari'), stat(fmt(o.last30d), 'Komisi 30 hari'),
    stat(fmt(o.earningsTotal), 'Total komisi seumur hidup'), stat(fmt(o.hostsApproved) + ' / ' + fmt(o.hosts), 'Host aktif / terdaftar'),
    stat((o.paidIdr ? rupiah(o.paidIdr) : '') + (o.paidIdr && o.paidUsdCents ? ' + ' : '') + (o.paidUsdCents ? usd(o.paidUsdCents) : '') || '-', 'Sudah dicairkan')));
  root.append(h('p', { class: 'dim', style: 'margin-top:16px' }, 'Komisi dihitung otomatis dari penghasilan host setiap ada gift atau pesan berbayar. Penarikan minimal ' + fmt(o.minDiamonds) + ' diamond, dibayar manual oleh admin.'));
  return root;
}

// ---------- Host ----------
async function pageHosts() {
  const list = await get('/hosts');
  const root = h('div', {}, head('Host saya', 'Host yang mendaftar dengan kode agency Anda dan komisi dari masing-masing.'));
  if (!list.length) { root.append(empty('Belum ada host. Bagikan kode agency Anda kepada calon host.')); return root; }
  const st = { approved: ['Aktif', 'green'], pending: ['Menunggu', 'amber'], rejected: ['Ditolak', 'red'] };
  const grid = h('div', { class: 'grid g2' });
  for (const x of list) {
    const [label, cls] = st[x.status] || ['-', ''];
    grid.append(h('div', { class: 'card' },
      h('div', { class: 'row' },
        x.avatarUrl ? h('img', { class: 'avatar', src: x.avatarUrl, alt: '' }) : h('div', { class: 'avatar' }, (x.displayName || '?')[0].toUpperCase()),
        h('div', { class: 'sp', style: 'min-width:0' }, h('b', {}, x.displayName + (x.verified ? ' ✔' : '')), h('div', { class: 'dim' }, 'ID ' + x.id + ' · ' + (x.countryCode || '-') + ' · aktif ' + ago(x.lastSeenAt))),
        h('span', { class: 'pill ' + cls }, label)),
      h('dl', { class: 'kv', style: 'margin:12px 0 0' },
        h('dt', {}, 'Komisi total'), h('dd', {}, '💎 ' + fmt(x.earned)),
        h('dt', {}, 'Komisi 7 hari'), h('dd', {}, '💎 ' + fmt(x.earned7d)),
        h('dt', {}, 'Bergabung'), h('dd', {}, ago(x.joinedAt)))));
  }
  root.append(grid);
  return root;
}

// ---------- Riwayat ----------
async function pageEarnings() {
  const list = await get('/earnings');
  const root = h('div', {}, head('Riwayat komisi', '100 komisi terbaru.'));
  if (!list.length) { root.append(empty('Belum ada komisi')); return root; }
  const src = { gift: '🎁 Gift', chat: '💬 Pesan' };
  root.append(h('div', { class: 'card', style: 'padding:6px 16px' }, list.map((e) =>
    h('div', { class: 'row', style: 'padding:10px 0;border-bottom:1px solid var(--border)' },
      h('div', { class: 'sp', style: 'min-width:0' }, h('b', {}, e.host.displayName), h('div', { class: 'dim' }, (src[e.source] || e.source) + ' · ' + ago(e.createdAt))),
      h('b', { style: 'color:#15803d' }, '+' + fmt(e.amount) + ' 💎')))));
  return root;
}

// ---------- Penarikan ----------
async function pageWithdraw() {
  const [o, hist] = await Promise.all([get('/withdraw/options'), get('/withdraw')]);
  const root = h('div', {}, head('Tarik komisi', o.method === 'idr' ? 'Dibayar admin ke rekening bank / e-wallet dalam Rupiah.' : 'Dibayar admin dalam USDT jaringan TRC20 (nilai USD).'));

  root.append(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'dim' }, 'Saldo tersedia'), h('div', { style: 'font-size:28px;font-weight:900' }, '💎 ' + fmt(o.balance)),
    h('div', { class: 'dim' }, 'Minimal tarik ' + fmt(o.minDiamonds) + ' diamond · 1 USD = ' + fmt(o.diamondsPerUsd) + ' diamond'
      + (o.currency === 'IDR' ? ' · kurs Rp ' + fmt(o.usdIdr) + '/USD' : '') + (o.method === 'usdt' && o.usdtFeeUsd ? ' · biaya jaringan $' + o.usdtFeeUsd : '') + (o.feePercent ? ' · biaya ' + o.feePercent + '%' : ''))));

  // Penarikan yang sedang diproses
  if (o.pending) {
    const w = o.pending;
    root.append(h('div', { class: 'card', style: 'margin-bottom:14px;border-color:#fde68a;background:#fffbeb' },
      h('b', {}, 'Penarikan sedang diproses'),
      h('div', { style: 'font-size:24px;font-weight:900;margin:4px 0' }, money(w.currency, w.net)),
      h('div', { class: 'dim' }, fmt(w.diamonds) + ' diamond · ke ' + w.provider + ' ' + w.accountNumber + ' · ' + ago(w.createdAt)),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn bad sm', onclick: async () => {
        if (confirm('Batalkan penarikan ini? Saldo dikembalikan.') && await act(() => post('/withdraw/' + w.id + '/cancel'), 'Dibatalkan, saldo dikembalikan')) renderApp();
      } }, 'Batalkan'))));
  }

  // Rekening
  const a = o.account;
  const providers = o.providers;
  const sel = h('select', {}, providers.map((p) => h('option', { value: p.name, selected: a && a.provider === p.name }, p.name)));
  const number = h('input', { type: 'text', autocomplete: 'off', placeholder: o.method === 'usdt' ? 'Alamat TRC20, diawali huruf T' : 'Nomor rekening / e-wallet', inputmode: o.method === 'usdt' ? 'text' : 'numeric' });
  const name = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Nama pemilik sesuai buku tabungan' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const nameField = field('Nama pemilik rekening', name);
  const sync = () => { const p = providers.find((x) => x.name === sel.value); nameField.style.display = p && p.kind === 'crypto' ? 'none' : ''; };
  sel.addEventListener('change', sync); sync();
  root.append(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('b', {}, a ? 'Rekening penarikan' : 'Tambahkan rekening penarikan'),
    a ? h('div', { class: 'muted', style: 'margin:6px 0 10px' }, a.provider + ' · ' + a.accountNumber + (a.accountName ? ' · ' + a.accountName : '') + (a.cooldownUntil ? ' · penarikan ditahan sampai ' + new Date(a.cooldownUntil).toLocaleString('id-ID') : '')) : h('div', { class: 'dim', style: 'margin:6px 0 10px' }, 'Wajib sebelum menarik.'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (await act(() => put('/withdraw/account', { provider: sel.value, accountNumber: number.value, accountName: name.value, password: pw.value }), 'Rekening disimpan')) renderApp();
    } },
      field('Metode', sel), field(o.method === 'usdt' ? 'Alamat dompet USDT (TRC20)' : 'Nomor', number), nameField,
      field('Password agency', pw, 'Untuk keamanan. Mengganti rekening menahan penarikan ' + o.cooldownHours + ' jam.'),
      h('button', { class: 'btn', type: 'submit' }, a ? 'Ganti rekening' : 'Simpan rekening'))));

  // Ajukan
  const dia = h('input', { type: 'number', min: o.minDiamonds, step: '1', placeholder: 'Minimal ' + fmt(o.minDiamonds) });
  const pw2 = h('input', { type: 'password', autocomplete: 'current-password' });
  const prev = h('div', { class: 'dim' });
  const upd = () => {
    const d = Math.floor(Number(dia.value) || 0);
    if (d <= 0) { prev.textContent = ''; return; }
    const gross = o.currency === 'IDR' ? Math.floor((d * o.usdIdr) / o.diamondsPerUsd) : Math.floor((d * 100) / o.diamondsPerUsd);
    const fee = Math.floor((gross * o.feePercent) / 100) + (o.method === 'usdt' ? Math.round(o.usdtFeeUsd * 100) : 0);
    prev.textContent = 'Perkiraan diterima: ' + money(o.currency, Math.max(0, gross - fee));
  };
  dia.addEventListener('input', upd);
  root.append(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('b', {}, 'Ajukan penarikan'),
    h('form', { style: 'margin-top:10px', onsubmit: async (e) => {
      e.preventDefault();
      if (await act(() => post('/withdraw', { diamonds: Math.floor(Number(dia.value)), password: pw2.value }), 'Penarikan diajukan')) renderApp();
    } },
      field('Jumlah diamond', dia, 'Saldo ' + fmt(o.balance) + ' diamond'), prev,
      h('div', { class: 'row', style: 'margin:8px 0' }, h('button', { type: 'button', class: 'btn sm', onclick: () => { dia.value = o.balance; upd(); } }, 'Semua saldo')),
      field('Password agency', pw2),
      h('button', { class: 'btn pri', type: 'submit', disabled: !a || !!o.pending }, o.pending ? 'Masih ada yang diproses' : a ? 'Ajukan penarikan' : 'Tambahkan rekening dulu'))));

  // Riwayat
  root.append(h('div', { class: 'sec' }, 'Riwayat penarikan'));
  const st = { pending: ['Diproses', 'amber'], paid: ['Dibayar', 'green'], rejected: ['Ditolak', 'red'], cancelled: ['Dibatalkan', ''] };
  if (!hist.length) root.append(empty('Belum ada penarikan'));
  root.append(...hist.map((w) => h('div', { class: 'card', style: 'margin-bottom:8px' },
    h('div', { class: 'row' },
      h('div', { class: 'sp' }, h('b', {}, money(w.currency, w.net)), h('div', { class: 'dim' }, fmt(w.diamonds) + ' 💎 · ' + w.provider + ' ' + w.accountNumber + ' · ' + ago(w.createdAt))),
      h('span', { class: 'pill ' + (st[w.status] ? st[w.status][1] : '') }, st[w.status] ? st[w.status][0] : w.status)),
    w.status === 'rejected' && w.adminNote ? h('div', { class: 'warn-text', style: 'margin-top:6px' }, 'Alasan: ' + w.adminNote) : null,
    w.status === 'paid' && w.transferRef ? h('div', { class: 'dim', style: 'margin-top:6px' }, 'Ref: ' + w.transferRef) : null)));
  return root;
}

// ---------- Akun ----------
async function pageAccount() {
  const o = await get('/overview');
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const root = h('div', {}, head('Akun'));
  root.append(h('div', { class: 'card', style: 'margin-bottom:14px;max-width:520px' },
    h('dl', { class: 'kv' },
      h('dt', {}, 'Nama agency'), h('dd', {}, o.agency.name),
      h('dt', {}, 'Username'), h('dd', {}, o.agency.username),
      h('dt', {}, 'Kode agency'), h('dd', {}, o.agency.code),
      h('dt', {}, 'Komisi'), h('dd', {}, Math.round(o.agency.commissionRate * 100) + '% dari penghasilan host'),
      h('dt', {}, 'Negara pembayaran'), h('dd', {}, o.agency.countryCode + (o.method === 'idr' ? ' (Rupiah)' : ' (USDT TRC20)')))));
  root.append(h('form', { class: 'card', style: 'max-width:520px', onsubmit: async (e) => {
    e.preventDefault();
    const r = await act(() => post('/password', { currentPassword: cur.value, newPassword: next.value }), 'Password diganti');
    if (r && r.accessToken) { setToken(r.accessToken); cur.value = ''; next.value = ''; }
  } },
    h('b', {}, 'Ganti password'),
    h('div', { style: 'margin-top:10px' }, field('Password lama', cur), field('Password baru', next, 'Minimal 8 karakter. Perangkat lain akan keluar otomatis.'), h('button', { class: 'btn pri', type: 'submit' }, 'Simpan password'))));
  return root;
}

renderApp();

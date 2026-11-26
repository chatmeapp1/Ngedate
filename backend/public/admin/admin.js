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

// ---------------------------------------------------------------------------
// Modal formulir
// ---------------------------------------------------------------------------
// fields: [{ name, label, type: text|number|textarea|select|checkbox|file, value, options, hint }]
function formModal({ title, fields, submit = 'Simpan', danger = false }) {
  return new Promise((resolve) => {
    const inputs = {};
    const body = fields.map((f) => {
      let input;
      if (f.type === 'textarea') input = h('textarea', { rows: 3, value: f.value ?? '' });
      else if (f.type === 'select') {
        input = h('select', {}, f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
      } else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: f.value });
      else if (f.type === 'file') input = h('input', { type: 'file', accept: f.accept || 'image/png,image/jpeg,image/webp' });
      else input = h('input', { type: f.type || 'text', value: f.value ?? '', autocomplete: 'off', step: f.type === 'number' ? 'any' : null });
      inputs[f.name] = input;
      if (f.type === 'checkbox') return h('label', { class: 'chk' }, input, f.label);
      return h('label', { class: 'f' }, h('span', {}, f.label), input, f.hint ? h('small', { class: 'hint' }, f.hint) : null);
    });
    const close = (v) => {
      wrap.remove();
      resolve(v);
    };
    const form = h(
      'form',
      {
        onsubmit: (e) => {
          e.preventDefault();
          const out = {};
          for (const f of fields) {
            const el = inputs[f.name];
            if (f.type === 'checkbox') out[f.name] = el.checked;
            else if (f.type === 'file') out[f.name] = el.files[0] || null;
            else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
            else out[f.name] = el.value.trim();
          }
          close(out);
        },
      },
      h('h3', {}, title),
      body,
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Batal'),
        h('button', { type: 'submit', class: 'btn ' + (danger ? 'bad' : 'pri') }, submit))
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

// ----- Dashboard -----
async function pageDashboard() {
  const s = await refreshStats();
  const sources = { chat: 'Pesan chat', gift: 'Gift' };
  const earn = Object.entries(s.platformEarnings);
  const totalEarn = earn.reduce((a, [, v]) => a + v, 0);
  const stat = (n, l, warn) => h('div', { class: 'card stat' + (warn ? ' warn' : '') }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  const pend = s.pending.verifications + s.pending.photos + s.pending.avatars;
  return [
    pageHead('Dashboard', 'Ringkasan Amora saat ini'),
    pend > 0
      ? h('div', { class: 'card stat warn', style: 'margin-bottom:12px' },
          h('div', { class: 'row wrap' },
            h('b', {}, pend + ' item menunggu tinjauan'),
            h('span', { class: 'sp' }),
            s.pending.verifications ? h('a', { class: 'btn pri sm', href: '#verifikasi' }, 'Verifikasi wajah (' + s.pending.verifications + ')') : null,
            s.pending.photos + s.pending.avatars ? h('a', { class: 'btn pri sm', href: '#foto' }, 'Foto host (' + (s.pending.photos + s.pending.avatars) + ')') : null))
      : null,
    h('div', { class: 'grid g3' },
      stat(fmt(s.users.user || 0), 'Pengguna'),
      stat(fmt(s.users.host || 0), 'Host'),
      stat(fmt(s.newUsers24h), 'Pendaftar 24 jam'),
      stat(fmt(s.messages24h), 'Pesan 24 jam'),
      stat(fmt(s.gifts24h), 'Koin gift 24 jam'),
      stat(fmt(s.agencies), 'Agency aktif'),
      stat(fmt(s.coinsInWallets), 'Koin di dompet user'),
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

// ----- Pengguna -----
const filt = { q: '', role: '', status: '' };
async function pageUsers() {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filt)) if (v) qs.set(k, v);
  const list = await get('/api/admin/users?' + qs.toString());
  const root = h('div', {}, pageHead('Pengguna', 'Maksimal 100 hasil terbaru. Gunakan pencarian nama, username, email, atau ID.'));
  const input = h('input', { type: 'search', placeholder: 'Cari…', value: filt.q, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const role = h('select', {}, [['', 'Semua peran'], ['user', 'User'], ['host', 'Host'], ['admin', 'Admin']].map(([v, l]) => h('option', { value: v, selected: filt.role === v }, l)));
  const status = h('select', {}, [['', 'Semua status'], ['active', 'Aktif'], ['suspended', 'Ditangguhkan']].map(([v, l]) => h('option', { value: v, selected: filt.status === v }, l)));
  const go = () => { filt.q = input.value.trim(); filt.role = role.value; filt.status = status.value; render(); };
  role.onchange = go; status.onchange = go;
  root.append(h('div', { class: 'search' }, input, role, status, h('button', { class: 'btn pri', onclick: go }, 'Cari')));
  if (!list.length) root.append(empty('Tidak ada pengguna'));

  const grid = h('div', { class: 'grid g2' });
  for (const u of list) {
    const isAdmin = u.role === 'admin';
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
  const root = h('div', {}, pageHead('Agency', 'Komisi agency diambil dari bagian host (maksimal ' + Math.round(share * 100) + '%).'));
  const fields = (a) => [
    { name: 'name', label: 'Nama agency', value: a && a.name },
    ...(a ? [] : [{ name: 'code', label: 'Kode undangan', hint: 'Kosongkan untuk dibuat otomatis (4–16 huruf/angka)' }]),
    { name: 'commission', label: 'Komisi (% dari pendapatan host)', type: 'number', value: a ? +(a.commissionRate * 100).toFixed(2) : 10, hint: 'Maksimal ' + Math.round(share * 100) + '%' },
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
        h('dt', {}, 'Kontak'), h('dd', {}, a.contact || '-')),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn sm', onclick: async () => {
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
    { name: 'sortOrder', label: 'Urutan', type: 'number', value: g ? g.sortOrder : 0, hint: 'Angka kecil tampil lebih dulu' },
    { name: 'image', label: 'Gambar gift (opsional)', type: 'file', hint: 'PNG/WEBP transparan, maks 5 MB. Menggantikan emoji.' },
    ...(g && g.imageUrl ? [{ name: 'removeImage', label: 'Hapus gambar yang ada', type: 'checkbox', value: false }] : []),
    { name: 'video', label: 'Efek MP4 layar penuh (opsional)', type: 'file', accept: 'video/mp4', hint: 'MP4 maks 15 MB, disarankan portrait (mis. 720x1280). Diputar maksimal 6 detik lalu memudar halus. Suara tidak diputar.' },
    ...(g && g.animationUrl ? [{ name: 'removeVideo', label: 'Hapus efek MP4 yang ada', type: 'checkbox', value: false }] : []),
    { name: 'blend', label: 'Latar video hitam → jadikan transparan', type: 'checkbox', value: g ? g.animationBlend : false },
    { name: 'active', label: 'Aktif (tampil di panel gift)', type: 'checkbox', value: g ? g.active : true },
  ];

  const save = async (g, r) => {
    let imageUrl;
    if (r.image) {
      const f = new FormData();
      f.append('file', r.image);
      imageUrl = (await api('POST', '/api/admin/upload', undefined, f)).url;
    } else if (r.removeImage) imageUrl = '';
    let animationUrl;
    if (r.video) {
      const f = new FormData();
      f.append('file', r.video);
      animationUrl = (await api('POST', '/api/admin/upload-video', undefined, f)).url;
    } else if (r.removeVideo) animationUrl = '';
    const body = { name: r.name, price: r.price, icon: r.icon || undefined, category: r.category, sortOrder: r.sortOrder ?? 0, active: r.active, animationBlend: r.blend };
    if (imageUrl !== undefined) body.imageUrl = imageUrl;
    if (animationUrl !== undefined) body.animationUrl = animationUrl;
    return g ? patch('/api/admin/gifts/' + g.id, body) : post('/api/admin/gifts', body);
  };

  root.append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn pri', onclick: async () => {
    const r = await formModal({ title: 'Gift baru', fields: fields(null), submit: 'Buat' });
    if (r && await act(() => save(null, r), 'Gift dibuat')) render();
  } }, '+ Gift baru')));
  if (!list.length) root.append(empty('Belum ada gift'));
  const grid = h('div', { class: 'grid g2' });
  for (const g of list) {
    grid.append(h('div', { class: 'card', style: g.active ? '' : 'opacity:.6' },
      h('div', { class: 'row' },
        giftIcon(g),
        h('div', { class: 'sp' }, h('b', {}, g.name), h('div', { class: 'dim' }, fmt(g.price) + ' koin · urutan ' + g.sortOrder)),
        h('div', { style: 'text-align:right' },
          h('span', { class: 'pill ' + (g.category === 'luxury' ? 'amber' : '') }, g.category === 'luxury' ? 'Mewah' : 'Populer'),
          h('div', { style: 'margin-top:4px' }, g.active ? null : h('span', { class: 'pill red' }, 'Nonaktif'), g.animationUrl ? h('span', { class: 'pill purple', style: 'margin-left:4px' }, '🎬 MP4') : null))),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn sm', onclick: async () => {
        const r = await formModal({ title: 'Ubah gift', fields: fields(g) });
        if (r && await act(() => save(g, r), 'Gift diperbarui')) render();
      } }, 'Ubah'))));
  }
  root.append(grid);
  return root;
}

// ----- Pengaturan -----
async function pageSettings() {
  const s = await get('/api/admin/settings');
  const root = h('div', {}, pageHead('Pengaturan', 'Berlaku langsung untuk semua pengguna.'));
  const defs = [
    { k: 'host_share', label: 'Bagian host (%)', hint: 'Sisanya untuk platform. Komisi agency dipotong dari bagian host.', conv: (v) => v * 100, back: (v) => v / 100, min: 0, max: 100 },
    { k: 'chat_price_min', label: 'Harga pesan minimum (koin)', min: 0 },
    { k: 'chat_price_max', label: 'Harga pesan maksimum (koin)', min: 0 },
    { k: 'wa_threshold_min', label: 'Syarat total gift untuk buka WA — minimum (koin)', min: 0 },
    { k: 'wa_threshold_max', label: 'Syarat total gift untuk buka WA — maksimum (koin)', min: 0 },
    { k: 'reply_window_hours', label: 'Batas balas sebelum koin dikembalikan (jam)', min: 1 },
  ];
  const inputs = {};
  const form = h('form', { class: 'card', style: 'max-width:520px', onsubmit: async (e) => {
    e.preventDefault();
    const body = {};
    for (const d of defs) {
      const raw = Number(inputs[d.k].value);
      if (!Number.isFinite(raw)) return toast(d.label + ' harus angka', true);
      body[d.k] = d.back ? d.back(raw) : raw;
    }
    if (await act(() => patch('/api/admin/settings', body), 'Pengaturan disimpan')) render();
  } },
    defs.map((d) => {
      const input = h('input', { type: 'number', step: 'any', min: d.min, max: d.max, value: d.conv ? d.conv(Number(s[d.k])) : s[d.k] });
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
  pengguna: { title: 'Pengguna', icon: '👥', fn: pageUsers },
  topup: { title: 'Top up koin', icon: '💰', fn: pageTopup },
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

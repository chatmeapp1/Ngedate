const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const wallet = require('../services/wallet');
const realtime = require('../realtime');
const { getSettings, updateSettings } = require('../services/settings');
const { wrap, badRequest, notFound } = require('../lib/errors');
const crypto = require('crypto');
const storage = require('../lib/storage');
const { describe } = require('../lib/gestures');
const { publicUser } = require('./serializers');
const { mapGift } = require('./gifts');

const router = express.Router();

router.get('/users', wrap(async (req, res) => {
  const q = v.str(req.query.q, 'q', { max: 50, optional: true });
  const role = v.str(req.query.role, 'role', { optional: true, pattern: /^(user|host|admin)$/ });
  const status = v.str(req.query.status, 'status', { optional: true, pattern: /^(active|suspended)$/ });
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    where.push(`(u.username LIKE $${i} OR lower(u.display_name) LIKE $${i} OR u.email LIKE $${i} OR u.id::text = $${i})`);
  }
  if (role) {
    params.push(role);
    where.push(`u.role = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`u.status = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT u.*, a.name AS agency_name FROM users u LEFT JOIN agencies a ON a.id = u.agency_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.id DESC LIMIT 100`,
    params
  );
  res.json(rows.map((u) => publicUser(u, { self: true })));
}));

// Unggah gambar (mis. gambar gift) -> URL
router.post('/upload', storage.single, wrap(async (req, res) => {
  const { url } = await storage.save(req);
  res.status(201).json({ url });
}));

// Jadikan user sebagai host (atau kembalikan ke user)
router.patch('/users/:id/role', wrap(async (req, res) => {
  const userId = v.id(req.params.id);
  const role = v.str(req.body.role, 'role', { pattern: /^(user|host)$/ });
  const { rows } = await db.query(
    `UPDATE users SET role = $2, updated_at = now() WHERE id = $1 AND role <> 'admin' RETURNING *`,
    [userId, role]
  );
  if (!rows.length) throw notFound('User tidak ditemukan');
  if (role === 'host') {
    // Dijadikan host langsung oleh admin: langsung disetujui & tampil
    await db.query(`UPDATE users SET host_status = 'approved', profile_completed = true WHERE id = $1`, [userId]);
    await db.query(`INSERT INTO host_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  } else {
    await db.query(`UPDATE users SET host_status = NULL WHERE id = $1`, [userId]);
  }
  res.json(publicUser(rows[0], { self: true }));
}));

router.patch('/users/:id/status', wrap(async (req, res) => {
  const userId = v.id(req.params.id);
  const status = v.str(req.body.status, 'status', { pattern: /^(active|suspended)$/ });
  const { rows } = await db.query(
    `UPDATE users SET status = $2, updated_at = now() WHERE id = $1 AND role <> 'admin' RETURNING *`,
    [userId, status]
  );
  if (!rows.length) throw notFound('User tidak ditemukan');
  if (status === 'suspended') await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
  res.json(publicUser(rows[0], { self: true }));
}));

// Tambah/kurangi koin manual (top up sementara sebelum Google Play Billing di Job 5)
router.post('/users/:id/coins', wrap(async (req, res) => {
  const userId = v.id(req.params.id);
  const amount = v.int(req.body.amount, 'amount', { min: -1e12, max: 1e12 });
  if (amount === 0) throw badRequest('amount tidak boleh 0');
  const note = v.str(req.body.note, 'note', { max: 200, optional: true });
  const balance = await db.tx(async (client) => {
    const { rows } = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (!rows.length) throw notFound('User tidak ditemukan');
    return amount > 0
      ? wallet.creditCoins(client, userId, amount, 'admin_topup', { type: 'admin', id: req.user.id, note })
      : wallet.debitCoins(client, userId, -amount, 'admin_adjust', { type: 'admin', id: req.user.id, note });
  });
  const b = await wallet.balances(db, userId);
  realtime.emitTo(userId, 'wallet:update', b);
  res.json({ coins: balance });
}));

router.get('/gifts', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM gifts ORDER BY sort_order, price`);
  res.json(rows.map(mapGift));
}));

function giftFields(b, optional) {
  return {
    name: v.str(b.name, 'Nama gift', { max: 50, optional }),
    price: v.int(b.price, 'Harga', { min: 1, max: 1e9, optional }),
    icon: v.str(b.icon, 'Ikon', { max: 16, optional: true }),
    // String kosong = hapus (null); tidak dikirim = tidak diubah
    image_url: b.imageUrl === '' ? null : v.str(b.imageUrl, 'Gambar', { max: 500, optional: true }),
    animation_url: b.animationUrl === '' ? null : v.str(b.animationUrl, 'Animasi', { max: 500, optional: true }),
    sound_url: b.soundUrl === '' ? null : v.str(b.soundUrl, 'Suara', { max: 500, optional: true }),
    category: v.str(b.category, 'Kategori', { max: 20, optional: true }),
    sort_order: v.int(b.sortOrder, 'Urutan', { optional: true }),
    active: v.bool(b.active, 'Aktif', { optional: true }),
  };
}

router.post('/gifts', wrap(async (req, res) => {
  const f = giftFields(req.body || {}, false);
  const { rows } = await db.query(
    `INSERT INTO gifts (name, price, image_url, animation_url, sound_url, category, sort_order, active, icon)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'normal'), COALESCE($7, 0), COALESCE($8, true), $9) RETURNING *`,
    [f.name, f.price, f.image_url, f.animation_url, f.sound_url, f.category, f.sort_order, f.active, f.icon]
  );
  res.status(201).json(mapGift(rows[0]));
}));

router.patch('/gifts/:id', wrap(async (req, res) => {
  const f = giftFields(req.body || {}, true);
  const sets = [];
  const params = [v.id(req.params.id)];
  for (const [col, val] of Object.entries(f)) {
    if (val === undefined) continue;
    params.push(val);
    sets.push(col + ' = $' + params.length);
  }
  if (!sets.length) throw badRequest('Tidak ada yang diubah');
  const { rows } = await db.query(`UPDATE gifts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!rows.length) throw notFound('Gift tidak ditemukan');
  res.json(mapGift(rows[0]));
}));

router.get('/settings', wrap(async (req, res) => {
  res.json(await getSettings());
}));

router.patch('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.host_share !== undefined) {
    const share = Number(b.host_share);
    if (!(share >= 0 && share <= 1)) throw badRequest('host_share harus 0 sampai 1');
  }
  res.json(await updateSettings(b));
}));

// Ringkasan untuk dashboard admin
router.get('/stats', wrap(async (req, res) => {
  const { rows: earnings } = await db.query(
    `SELECT source, COALESCE(SUM(amount), 0) AS total FROM platform_earnings GROUP BY source`
  );
  const { rows: users } = await db.query(`SELECT role, COUNT(*) AS n FROM users GROUP BY role`);
  const { rows: held } = await db.query(
    `SELECT COALESCE(SUM(price), 0) AS held FROM messages WHERE payment_status = 'held'`
  );
  const { rows: extra } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM verifications WHERE status = 'pending')::int AS pending_verifications,
       (SELECT COUNT(*) FROM user_photos WHERE status = 'pending')::int AS pending_photos,
       (SELECT COUNT(*) FROM users WHERE pending_avatar_url IS NOT NULL)::int AS pending_avatars,
       (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '24 hours')::int AS new_users_24h,
       (SELECT COUNT(*) FROM messages WHERE type = 'text' AND created_at > now() - interval '24 hours')::int AS messages_24h,
       (SELECT COALESCE(SUM(price), 0) FROM messages WHERE type = 'gift' AND created_at > now() - interval '24 hours')::bigint AS gifts_24h,
       (SELECT COALESCE(SUM(coins), 0) FROM users)::bigint AS coins_total,
       (SELECT COUNT(*) FROM agencies WHERE active)::int AS agencies`
  );
  const x = extra[0];
  res.json({
    platformEarnings: Object.fromEntries(earnings.map((r) => [r.source, Number(r.total)])),
    users: Object.fromEntries(users.map((r) => [r.role, Number(r.n)])),
    heldCoins: Number(held[0].held),
    pending: {
      verifications: x.pending_verifications,
      photos: x.pending_photos,
      avatars: x.pending_avatars,
    },
    newUsers24h: x.new_users_24h,
    messages24h: x.messages_24h,
    gifts24h: Number(x.gifts_24h),
    coinsInWallets: Number(x.coins_total),
    agencies: x.agencies,
  });
}));

// ---------------------------------------------------------------------------
// Agency
// ---------------------------------------------------------------------------
function mapAgency(a) {
  return {
    id: Number(a.id),
    name: a.name,
    code: a.code,
    commissionRate: Number(a.commission_rate),
    active: a.active,
    earningsTotal: Number(a.earnings_total),
    contact: a.contact,
    hosts: a.hosts === undefined ? undefined : Number(a.hosts),
    createdAt: a.created_at,
  };
}

async function checkRate(rate) {
  if (rate === undefined) return;
  const n = Number(rate);
  const { host_share } = await getSettings();
  if (!(n >= 0 && n <= Number(host_share))) {
    throw badRequest(`Komisi agency harus 0 sampai ${host_share} (tidak boleh melebihi bagian host)`);
  }
}

router.get('/agencies', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, (SELECT COUNT(*) FROM users u WHERE u.agency_id = a.id) AS hosts FROM agencies a ORDER BY a.id`
  );
  res.json(rows.map(mapAgency));
}));

router.post('/agencies', wrap(async (req, res) => {
  const b = req.body || {};
  const name = v.str(b.name, 'Nama agency', { min: 2, max: 80 });
  let code = v.str(b.code, 'Kode', { min: 4, max: 16, optional: true, pattern: /^[A-Za-z0-9]+$/ });
  code = code ? code.toUpperCase() : crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  await checkRate(b.commissionRate);
  const contact = v.str(b.contact, 'Kontak', { max: 120, optional: true });
  try {
    const { rows } = await db.query(
      `INSERT INTO agencies (name, code, commission_rate, contact) VALUES ($1, $2, COALESCE($3, 0.1), $4) RETURNING *`,
      [name, code, b.commissionRate ?? null, contact ?? null]
    );
    res.status(201).json(mapAgency(rows[0]));
  } catch (e) {
    if (e.code === '23505') throw badRequest('Kode agency sudah dipakai', 'CODE_TAKEN');
    throw e;
  }
}));

router.patch('/agencies/:id', wrap(async (req, res) => {
  const b = req.body || {};
  await checkRate(b.commissionRate);
  const { rows } = await db.query(
    `UPDATE agencies SET
       name = COALESCE($2, name),
       commission_rate = COALESCE($3, commission_rate),
       active = COALESCE($4, active),
       contact = COALESCE($5, contact)
     WHERE id = $1 RETURNING *`,
    [
      v.id(req.params.id),
      v.str(b.name, 'Nama agency', { min: 2, max: 80, optional: true }) ?? null,
      b.commissionRate ?? null,
      v.bool(b.active, 'Aktif', { optional: true }) ?? null,
      v.str(b.contact, 'Kontak', { max: 120, optional: true }) ?? null,
    ]
  );
  if (!rows.length) throw notFound('Agency tidak ditemukan');
  res.json(mapAgency(rows[0]));
}));

// ---------------------------------------------------------------------------
// Verifikasi wajah host
// ---------------------------------------------------------------------------
router.get('/verifications', wrap(async (req, res) => {
  const status = v.str(req.query.status ?? 'pending', 'status', { pattern: /^(pending|approved|rejected)$/ });
  const { rows } = await db.query(
    `SELECT vf.*, u.display_name, u.username, u.avatar_url, u.birth_date, a.name AS agency_name
     FROM verifications vf JOIN users u ON u.id = vf.user_id LEFT JOIN agencies a ON a.id = u.agency_id
     WHERE vf.status = $1 ORDER BY vf.id LIMIT 100`,
    [status]
  );
  res.json(rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_url,
    birthDate: r.birth_date,
    agencyName: r.agency_name,
    steps: describe(r.steps),
    photoUrls: r.photo_urls,
    durationMs: r.duration_ms,
    status: r.status,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
  })));
}));

router.post('/verifications/:id/approve', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  await db.tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE verifications SET status = 'approved', reviewed_by = $2, reviewed_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING user_id`,
      [id, req.user.id]
    );
    if (!rows.length) throw notFound('Verifikasi tidak ditemukan atau sudah ditinjau');
    // Host terverifikasi: centang biru, tampil di daftar host
    await client.query(
      `UPDATE users SET verified = true, host_status = 'approved', updated_at = now() WHERE id = $1`,
      [rows[0].user_id]
    );
  });
  res.json({ ok: true });
}));

router.post('/verifications/:id/reject', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  const reason = v.str(req.body.reason, 'Alasan', { min: 3, max: 200 });
  const { rows } = await db.query(
    `UPDATE verifications SET status = 'rejected', reject_reason = $3, reviewed_by = $2, reviewed_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING user_id`,
    [id, req.user.id, reason]
  );
  if (!rows.length) throw notFound('Verifikasi tidak ditemukan atau sudah ditinjau');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Cek foto host (album & foto profil baru)
// ---------------------------------------------------------------------------
router.get('/photos/pending', wrap(async (req, res) => {
  const [album, avatars] = await Promise.all([
    db.query(
      `SELECT p.id, p.url, p.user_id, u.display_name FROM user_photos p JOIN users u ON u.id = p.user_id
       WHERE p.status = 'pending' ORDER BY p.id LIMIT 200`
    ),
    db.query(
      `SELECT id AS user_id, pending_avatar_url AS url, display_name FROM users
       WHERE pending_avatar_url IS NOT NULL ORDER BY updated_at LIMIT 200`
    ),
  ]);
  res.json({
    album: album.rows.map((r) => ({ id: Number(r.id), url: r.url, userId: Number(r.user_id), displayName: r.display_name })),
    avatars: avatars.rows.map((r) => ({ userId: Number(r.user_id), url: r.url, displayName: r.display_name })),
  });
}));

router.post('/photos/:id/approve', wrap(async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE user_photos SET status = 'approved', reject_reason = NULL WHERE id = $1`,
    [v.id(req.params.id)]
  );
  if (!rowCount) throw notFound('Foto tidak ditemukan');
  res.json({ ok: true });
}));

router.post('/photos/:id/reject', wrap(async (req, res) => {
  const reason = v.str(req.body.reason, 'Alasan', { min: 3, max: 200 });
  const { rowCount } = await db.query(
    `UPDATE user_photos SET status = 'rejected', reject_reason = $2 WHERE id = $1`,
    [v.id(req.params.id), reason]
  );
  if (!rowCount) throw notFound('Foto tidak ditemukan');
  res.json({ ok: true });
}));

router.post('/users/:id/avatar/approve', wrap(async (req, res) => {
  const userId = v.id(req.params.id);
  const { rows } = await db.query(
    `SELECT avatar_url, pending_avatar_url FROM users WHERE id = $1`, [userId]
  );
  if (!rows.length || !rows[0].pending_avatar_url) throw notFound('Tidak ada foto profil yang menunggu');
  await db.query(
    `UPDATE users SET avatar_url = pending_avatar_url, pending_avatar_url = NULL, updated_at = now() WHERE id = $1`,
    [userId]
  );
  if (rows[0].avatar_url) await storage.remove(rows[0].avatar_url);
  res.json({ ok: true });
}));

router.post('/users/:id/avatar/reject', wrap(async (req, res) => {
  const userId = v.id(req.params.id);
  const { rows } = await db.query(
    `UPDATE users u SET pending_avatar_url = NULL, updated_at = now()
     FROM (SELECT pending_avatar_url AS old FROM users WHERE id = $1) o
     WHERE u.id = $1 AND o.old IS NOT NULL RETURNING o.old`,
    [userId]
  );
  if (!rows.length) throw notFound('Tidak ada foto profil yang menunggu');
  await storage.remove(rows[0].old);
  res.json({ ok: true });
}));

module.exports = router;

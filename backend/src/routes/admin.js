const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const wallet = require('../services/wallet');
const realtime = require('../realtime');
const { getSettings, updateSettings } = require('../services/settings');
const { wrap, badRequest, notFound } = require('../lib/errors');
const { publicUser } = require('./serializers');
const { mapGift } = require('./gifts');

const router = express.Router();

router.get('/users', wrap(async (req, res) => {
  const q = v.str(req.query.q, 'q', { max: 50, optional: true });
  const params = [];
  let where = '';
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where = `WHERE username LIKE $1 OR lower(display_name) LIKE $1 OR email LIKE $1 OR id::text = $1`;
  }
  const { rows } = await db.query(`SELECT * FROM users ${where} ORDER BY id DESC LIMIT 100`, params);
  res.json(rows.map((u) => publicUser(u, { self: true })));
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
    await db.query(`INSERT INTO host_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
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
    image_url: v.str(b.imageUrl, 'Gambar', { max: 500, optional: true }),
    animation_url: v.str(b.animationUrl, 'Animasi', { max: 500, optional: true }),
    sound_url: v.str(b.soundUrl, 'Suara', { max: 500, optional: true }),
    category: v.str(b.category, 'Kategori', { max: 20, optional: true }),
    sort_order: v.int(b.sortOrder, 'Urutan', { optional: true }),
    active: v.bool(b.active, 'Aktif', { optional: true }),
  };
}

router.post('/gifts', wrap(async (req, res) => {
  const f = giftFields(req.body || {}, false);
  const { rows } = await db.query(
    `INSERT INTO gifts (name, price, image_url, animation_url, sound_url, category, sort_order, active)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'normal'), COALESCE($7, 0), COALESCE($8, true)) RETURNING *`,
    [f.name, f.price, f.image_url, f.animation_url, f.sound_url, f.category, f.sort_order, f.active]
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

// Ringkasan: pendapatan platform & jumlah pengguna
router.get('/stats', wrap(async (req, res) => {
  const { rows: earnings } = await db.query(
    `SELECT source, COALESCE(SUM(amount), 0) AS total FROM platform_earnings GROUP BY source`
  );
  const { rows: users } = await db.query(`SELECT role, COUNT(*) AS n FROM users GROUP BY role`);
  const { rows: held } = await db.query(
    `SELECT COALESCE(SUM(price), 0) AS held FROM messages WHERE payment_status = 'held'`
  );
  res.json({
    platformEarnings: Object.fromEntries(earnings.map((r) => [r.source, Number(r.total)])),
    users: Object.fromEntries(users.map((r) => [r.role, Number(r.n)])),
    heldCoins: Number(held[0].held),
  });
}));

module.exports = router;

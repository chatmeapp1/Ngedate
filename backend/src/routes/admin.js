const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const wallet = require('../services/wallet');
const realtime = require('../realtime');
const { getSettings, updateSettings } = require('../services/settings');
const { wrap, badRequest, notFound } = require('../lib/errors');
const { notify, money } = require('../services/notifications');
const crypto = require('crypto');
const storage = require('../lib/storage');
const { describe } = require('../lib/gestures');
const { publicUser } = require('./serializers');
const { mapGift } = require('./gifts');
const { REPORT_REASONS } = require('../services/safety');
const withdraw = require('../services/withdraw');
const economy = require('../services/economy');
const membership = require('../services/membership');
const agencyPanel = require('../services/agencyPanel');

const router = express.Router();

router.get('/users', wrap(async (req, res) => {
  const q = v.str(req.query.q, 'q', { max: 50, optional: true });
  const role = v.str(req.query.role, 'role', { optional: true, pattern: /^(user|host|admin)$/ });
  const status = v.str(req.query.status, 'status', { optional: true, pattern: /^(active|suspended|deleted)$/ });
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    // ID dicocokkan persis (parameter terpisah dari pola LIKE)
    params.push(q);
    const j = params.length;
    where.push(`(u.username LIKE $${i} OR lower(u.display_name) LIKE $${i} OR u.email LIKE $${i} OR u.id::text = $${j})`);
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
    `UPDATE users SET role = $2, updated_at = now() WHERE id = $1 AND role <> 'admin' AND status <> 'deleted' RETURNING *`,
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
    `UPDATE users SET status = $2, updated_at = now() WHERE id = $1 AND role <> 'admin' AND status <> 'deleted' RETURNING *`,
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
    if (amount > 0) await membership.addTopup(client, userId, amount); // naikkan level/VIP
    return amount > 0
      ? wallet.creditCoins(client, userId, amount, 'admin_topup', { type: 'admin', id: req.user.id, note })
      : wallet.debitCoins(client, userId, -amount, 'admin_adjust', { type: 'admin', id: req.user.id, note });
  });
  const b = await wallet.balances(db, userId);
  realtime.emitTo(userId, 'wallet:update', b);
  if (amount > 0) await notify(userId, 'topup', 'Top up berhasil', `${amount.toLocaleString('id-ID')} koin sudah ditambahkan ke saldo kamu.`);
  res.json({ coins: balance });
}));

// Riwayat top up / penyesuaian koin oleh admin (terbaru dulu)
// Unggah video efek gift (MP4, maks 15 MB) -> URL
router.post('/upload-video', storage.singleVideo, wrap(async (req, res) => {
  const { url } = await storage.saveVideo(req);
  res.status(201).json({ url });
}));

// Unggah suara gift (maks 2 MB) -> URL
router.post('/upload-audio', storage.singleAudio, wrap(async (req, res) => {
  const { url } = await storage.saveAudio(req);
  res.status(201).json({ url });
}));

router.get('/coin-log', wrap(async (req, res) => {
  const userId = v.int(req.query.userId, 'userId', { min: 1, optional: true });
  const params = [];
  let where = `l.currency = 'coin' AND l.reason IN ('admin_topup', 'admin_adjust')`;
  if (userId) {
    params.push(userId);
    where += ` AND l.user_id = $1`;
  }
  const { rows } = await db.query(
    `SELECT l.id, l.user_id, l.amount, l.balance_after, l.reason, l.note, l.created_at,
            u.display_name, u.username, adm.username AS admin_username
     FROM ledger l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN users adm ON adm.id = l.ref_id AND l.ref_type = 'admin'
     WHERE ${where} ORDER BY l.id DESC LIMIT 50`,
    params
  );
  res.json(rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    displayName: r.display_name,
    username: r.username,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    note: r.note,
    admin: r.admin_username,
    createdAt: r.created_at,
  })));
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
    animation_blend: v.bool(b.animationBlend, 'Mode transparan', { optional: true }),
    host_multiplier: v.int(b.hostMultiplier, 'Pengali host', { min: 1, max: 5, optional: true }),
  };
}

router.post('/gifts', wrap(async (req, res) => {
  const f = giftFields(req.body || {}, false);
  const rows = await db.tx(async (client) => {
    let out;
    await economy.guard(client, {}, async () => {
      out = (await client.query(
    `INSERT INTO gifts (name, price, image_url, animation_url, sound_url, category, sort_order, active, icon, animation_blend, host_multiplier)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'normal'), COALESCE($7, 0), COALESCE($8, true), $9, COALESCE($10, false), COALESCE($11, 1)) RETURNING *`,
    [f.name, f.price, f.image_url, f.animation_url, f.sound_url, f.category, f.sort_order, f.active, f.icon, f.animation_blend, f.host_multiplier]
      )).rows;
    });
    return out;
  });
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
  const rows = await db.tx(async (client) => {
    let out;
    await economy.guard(client, {}, async () => {
      out = (await client.query(`UPDATE gifts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)).rows;
    });
    return out;
  });
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
  for (const [k, count, label] of [['level_thresholds', 11, 'Batas level (Level 0 sampai 10)'], ['host_level_thresholds', 11, 'Batas level host (Level 0 sampai 10)'], ['vip_thresholds', 5, 'Batas VIP (VIP 1 sampai 5)']]) {
    if (b[k] === undefined) continue;
    const list = membership.parseList(b[k], null);
    if (!list || list.length !== count) throw badRequest(`${label}: isi ${count} angka dipisah koma`);
    if (list.some((n, i) => i > 0 && n <= list[i - 1])) throw badRequest(`${label}: angka harus makin besar`);
    if ((k === 'level_thresholds' || k === 'host_level_thresholds') && list[0] !== 0) throw badRequest('Level 0 harus dimulai dari 0');
    b[k] = list.map(Math.round);
  }
  if (b.checkin_rewards !== undefined) b.checkin_rewards = require('../services/checkin').parseRewardList(b.checkin_rewards);
  for (const k of ['host_media_price_max', 'host_media_per_day', 'host_video_max_seconds']) if (b[k] !== undefined) b[k] = Math.round(Number(b[k]));
  if (b.vip_media_per_day !== undefined) b.vip_media_per_day = Math.round(Number(b.vip_media_per_day));
  if (b.free_cards_per_day !== undefined) b.free_cards_per_day = Math.round(Number(b.free_cards_per_day));
  if (b.free_card_host_diamonds !== undefined) b.free_card_host_diamonds = Math.round(Number(b.free_card_host_diamonds));
  if (b.gift_host_share !== undefined) {
    const share = Number(b.gift_host_share);
    if (!(share >= 0 && share <= 1)) throw badRequest('gift_host_share harus 0 sampai 1');
  }
  const whole = (k, label, min, max) => {
    if (b[k] === undefined) return;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${label} harus antara ${min} dan ${max}`);
  };
  whole('coin_price_idr', 'Harga jual 1 koin (Rupiah)', 0.01, 100000);
  whole('withdraw_diamonds_per_usd', 'Diamond per 1 USD', 1, 1e7);
  whole('withdraw_usd_idr', 'Kurs Rupiah per 1 USD', 1000, 100000);
  whole('withdraw_min_diamonds', 'Minimal penarikan', 1, 1e9);
  whole('free_cards_per_day', 'Kartu gratis per hari', 0, 100);
  whole('vip_media_per_day', 'Foto/video per hari', 0, 1000);
  whole('host_media_price_max', 'Harga maksimum foto/video privat', 0, 1e7);
  whole('host_media_per_day', 'Foto/video privat host per hari', 0, 1000);
  whole('host_video_max_seconds', 'Video privat maksimum (detik)', 10, 3600);
  whole('free_card_host_diamonds', 'Diamond host per pesan gratis', 0, 1000);
  for (const [k, label] of [['task_reward_moment', 'Hadiah tugas momen'], ['task_reward_photos', 'Hadiah tugas foto'], ['task_reward_checkin', 'Hadiah tugas check-in host'], ['task_reward_like', 'Hadiah tugas sukai']]) whole(k, label, 0, 10000);
  whole('task_like_target', 'Target sukai per hari', 1, 500);
  for (const k of ['task_reward_moment', 'task_reward_photos', 'task_reward_checkin', 'task_reward_like', 'task_like_target']) if (b[k] !== undefined) b[k] = Math.round(Number(b[k]));
  whole('withdraw_fee_percent', 'Biaya penarikan (%)', 0, 50);
  whole('withdraw_usdt_fee_usd', 'Biaya jaringan USDT (USD)', 0, 50);
  for (const k of ['withdraw_diamonds_per_usd', 'withdraw_usd_idr', 'withdraw_min_diamonds']) {
    if (b[k] !== undefined) b[k] = Math.round(Number(b[k]));
  }
  if (b.topup_contact !== undefined) {
    let digits = String(b.topup_contact).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `62${digits.slice(1)}`; // 08xx -> 628xx
    if (digits && (digits.length < 8 || digits.length > 15)) throw badRequest('Nomor WhatsApp tidak valid (sertakan kode negara)');
    b.topup_contact = digits;
  }
  if (b.topup_note !== undefined) {
    if (typeof b.topup_note !== 'string' || b.topup_note.length > 500) throw badRequest('Catatan pembayaran maksimal 500 karakter');
    b.topup_note = b.topup_note.trim();
  }
  // Tolak pengaturan yang membuat app rugi (harga, bagian host, nilai diamond)
  await economy.guard(db, { settings: b });
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
       (SELECT COUNT(*) FROM reports WHERE status = 'pending')::int AS pending_reports,
       (SELECT COUNT(*) FROM moments WHERE status = 'pending')::int AS pending_moments,
       ((SELECT COUNT(*) FROM withdrawals WHERE status = 'pending') + (SELECT COUNT(*) FROM agency_withdrawals WHERE status = 'pending'))::int AS pending_withdrawals,
       ((SELECT COALESCE(SUM(net), 0) FROM withdrawals WHERE status = 'pending' AND currency = 'IDR') + (SELECT COALESCE(SUM(net), 0) FROM agency_withdrawals WHERE status = 'pending' AND currency = 'IDR'))::bigint AS pending_withdraw_idr,
       ((SELECT COALESCE(SUM(net), 0) FROM withdrawals WHERE status = 'pending' AND currency = 'USD') + (SELECT COALESCE(SUM(net), 0) FROM agency_withdrawals WHERE status = 'pending' AND currency = 'USD'))::bigint AS pending_withdraw_usd_cents,
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
      reports: x.pending_reports,
      moments: x.pending_moments,
      withdrawals: x.pending_withdrawals,
    },
    pendingWithdrawIdr: Number(x.pending_withdraw_idr),
    pendingWithdrawUsdCents: Number(x.pending_withdraw_usd_cents),
    newUsers24h: x.new_users_24h,
    messages24h: x.messages_24h,
    gifts24h: Number(x.gifts_24h),
    coinsInWallets: Number(x.coins_total),
    onlineNow: realtime.onlineUserIds().length,
    agencies: x.agencies,
  });
}));

// ---------------------------------------------------------------------------
// Laporan pengguna
// ---------------------------------------------------------------------------
router.get('/reports', wrap(async (req, res) => {
  const status = v.str(req.query.status ?? 'pending', 'status', { pattern: /^(pending|resolved|dismissed)$/ });
  const { rows } = await db.query(
    `SELECT r.*,
            rp.username AS reporter_username, rp.display_name AS reporter_name, rp.avatar_url AS reporter_avatar,
            t.username AS target_username, t.display_name AS target_name, t.avatar_url AS target_avatar,
            t.role AS target_role, t.status AS target_status,
            (SELECT COUNT(*) FROM reports x WHERE x.target_id = r.target_id)::int AS target_total,
            (SELECT COUNT(DISTINCT x.reporter_id) FROM reports x WHERE x.target_id = r.target_id)::int AS target_reporters,
            (SELECT COUNT(*) FROM blocks b WHERE b.blocked_id = r.target_id)::int AS target_blocks
     FROM reports r
     JOIN users rp ON rp.id = r.reporter_id
     JOIN users t ON t.id = r.target_id
     WHERE r.status = $1 ORDER BY r.id DESC LIMIT 100`,
    [status]
  );
  res.json(rows.map((r) => ({
    id: Number(r.id),
    reason: r.reason,
    reasonLabel: REPORT_REASONS[r.reason] || r.reason,
    details: r.details,
    evidence: r.evidence,
    snapshot: r.snapshot,
    momentId: r.moment_id === null ? null : Number(r.moment_id),
    commentId: r.comment_id === null ? null : Number(r.comment_id),
    status: r.status,
    action: r.action,
    adminNote: r.admin_note,
    createdAt: r.created_at,
    reporter: { id: Number(r.reporter_id), username: r.reporter_username, displayName: r.reporter_name, avatarUrl: r.reporter_avatar },
    target: {
      id: Number(r.target_id), username: r.target_username, displayName: r.target_name, avatarUrl: r.target_avatar,
      role: r.target_role, status: r.target_status,
      totalReports: r.target_total, reporters: r.target_reporters, blockedBy: r.target_blocks,
    },
  })));
}));

// decision: dismiss (tidak melanggar) | resolve (sudah ditangani) | suspend (resolve + tangguhkan akun terlapor)
router.post('/reports/:id/review', wrap(async (req, res) => {
  const id = v.id(req.params.id);
  const decision = v.str(req.body.decision, 'Keputusan', { pattern: /^(dismiss|resolve|suspend|remove)$/ });
  const note = v.str(req.body.note, 'Catatan', { max: 300, optional: true }) ?? null;
  let removedImage = null;
  let removedHost = null;
  await db.tx(async (client) => {
    // Hapus konten yang dilaporkan (momen atau komentar), lalu laporan dianggap selesai
    if (decision === 'remove') {
      const { rows: rp } = await client.query(`SELECT moment_id, comment_id, target_id FROM reports WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
      if (!rp.length) throw notFound('Laporan tidak ditemukan atau sudah ditinjau');
      if (!rp[0].moment_id && !rp[0].comment_id) throw badRequest('Laporan ini tidak punya momen atau komentar untuk dihapus');
      if (rp[0].comment_id) {
        await client.query(`DELETE FROM moment_comments WHERE id = $1`, [rp[0].comment_id]);
      } else {
        const { rows: del } = await client.query(`DELETE FROM moments WHERE id = $1 RETURNING image_url, host_id`, [rp[0].moment_id]);
        if (del.length) {
          removedImage = del[0].image_url;
          removedHost = Number(del[0].host_id);
        }
      }
    }
    const { rows } = await client.query(
      `UPDATE reports SET status = $2, action = $3, admin_note = $4, reviewed_by = $5, reviewed_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING target_id`,
      [id, decision === 'dismiss' ? 'dismissed' : 'resolved', decision, note, req.user.id]
    );
    if (!rows.length) throw notFound('Laporan tidak ditemukan atau sudah ditinjau');
    if (decision === 'suspend') {
      const targetId = rows[0].target_id;
      await client.query(`UPDATE users SET status = 'suspended', updated_at = now() WHERE id = $1 AND role <> 'admin'`, [targetId]);
      await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [targetId]);
      // Laporan lain terhadap akun yang sama ikut dianggap selesai
      await client.query(
        `UPDATE reports SET status = 'resolved', action = 'suspend', admin_note = COALESCE(admin_note, 'Akun ditangguhkan'),
                reviewed_by = $2, reviewed_at = now()
         WHERE target_id = $1 AND status = 'pending'`,
        [targetId, req.user.id]
      );
    }
  });
  if (removedImage) await require('../lib/storage').remove(removedImage);
  if (removedHost) await notify(removedHost, 'moment', 'Momen dihapus admin', 'Momenmu dihapus karena dilaporkan melanggar aturan konten.');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Penarikan diamond host (dibayar manual oleh admin)
// ---------------------------------------------------------------------------
router.get('/withdrawals', wrap(async (req, res) => {
  const status = v.str(req.query.status ?? 'pending', 'status', { pattern: /^(pending|paid|rejected|cancelled)$/ });
  const host = (await withdraw.adminList(status)).map((w) => ({ ...w, owner: 'host' }));
  const agency = await agencyPanel.adminList(status); // penarikan komisi agency
  const dir = status === 'pending' ? 1 : -1;
  res.json([...host, ...agency].sort((a, b) => dir * (new Date(a.createdAt) - new Date(b.createdAt))));
}));

router.post('/agency-withdrawals/:id/pay', wrap(async (req, res) => {
  await agencyPanel.adminPay(req.user.id, req.params.id, req.body || {});
  res.json({ ok: true });
}));

router.post('/agency-withdrawals/:id/reject', wrap(async (req, res) => {
  await agencyPanel.adminReject(req.user.id, req.params.id, req.body || {});
  res.json({ ok: true });
}));

router.post('/withdrawals/:id/pay', wrap(async (req, res) => {
  const w = await withdraw.adminPay(req.user.id, req.params.id, req.body || {});
  realtime.emitTo(Number(w.user_id), 'withdrawal:update', { id: Number(w.id), status: 'paid' });
  await notify(Number(w.user_id), 'withdraw', 'Penarikan terkirim', `Penarikan ${money(w)} sudah dikirim ke rekening/dompet kamu.`);
  res.json({ ok: true });
}));

router.post('/withdrawals/:id/reject', wrap(async (req, res) => {
  const w = await withdraw.adminReject(req.user.id, req.params.id, req.body || {});
  realtime.emitTo(Number(w.user_id), 'withdrawal:update', { id: Number(w.id), status: 'rejected' });
  await notify(Number(w.user_id), 'withdraw', 'Penarikan ditolak', `Penarikan ${money(w)} ditolak dan diamond dikembalikan ke saldo kamu.`);
  const b = await wallet.balances(db, Number(w.user_id));
  if (b) realtime.emitTo(Number(w.user_id), 'wallet:update', b);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Paket koin (layar Top up)
// ---------------------------------------------------------------------------
const mapPackage = (r) => ({
  id: r.id,
  coins: Number(r.coins),
  priceIdr: Number(r.price_idr),
  priceUsdCents: r.price_usd_cents,
  badge: r.badge,
  sortOrder: r.sort_order,
  active: r.active,
});

function packageFields(b, optional) {
  return {
    coins: v.int(b.coins, 'Jumlah koin', { min: 100, max: 1e9, optional }),
    price_idr: v.int(b.priceIdr, 'Harga Rupiah', { min: 1, max: 1e12, optional }),
    price_usd_cents: v.int(b.priceUsdCents, 'Harga USD (sen)', { min: 1, max: 1e9, optional }),
    badge: b.badge === '' ? null : v.str(b.badge, 'Label', { max: 20, optional: true }),
    sort_order: v.int(b.sortOrder, 'Urutan', { optional: true }),
    active: v.bool(b.active, 'Aktif', { optional: true }),
  };
}

router.get('/packages', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM coin_packages ORDER BY sort_order, coins`);
  res.json(rows.map(mapPackage));
}));

router.post('/packages', wrap(async (req, res) => {
  const f = packageFields(req.body || {}, false);
  try {
    const created = await db.tx(async (client) => {
      let row;
      await economy.guard(client, {}, async () => {
        const { rows } = await client.query(
          `INSERT INTO coin_packages (coins, price_idr, price_usd_cents, badge, sort_order, active)
           VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, true)) RETURNING *`,
          [f.coins, f.price_idr, f.price_usd_cents, f.badge ?? null, f.sort_order, f.active]
        );
        row = rows[0];
      });
      return row;
    });
    res.status(201).json(mapPackage(created));
  } catch (e) {
    if (e.code === '23505') throw badRequest('Paket dengan jumlah koin ini sudah ada', 'DUPLICATE_PACKAGE');
    throw e;
  }
}));

router.patch('/packages/:id', wrap(async (req, res) => {
  const f = packageFields(req.body || {}, true);
  const sets = [];
  const params = [v.id(req.params.id)];
  for (const [col, val] of Object.entries(f)) {
    if (val === undefined) continue;
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) throw badRequest('Tidak ada yang diubah');
  try {
    const updated = await db.tx(async (client) => {
      let row;
      await economy.guard(client, {}, async () => {
        const { rows } = await client.query(`UPDATE coin_packages SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
        row = rows[0];
      });
      return row;
    });
    if (!updated) throw notFound('Paket tidak ditemukan');
    res.json(mapPackage(updated));
  } catch (e) {
    if (e.code === '23505') throw badRequest('Paket dengan jumlah koin ini sudah ada', 'DUPLICATE_PACKAGE');
    throw e;
  }
}));

// Atur ulang password pengguna (lupa password tanpa kode pemulihan): password sementara, tampil sekali
router.post('/users/:id/reset-password', wrap(async (req, res) => {
  const r = await require('../services/account').adminResetPassword(v.id(req.params.id));
  realtime.disconnectUser(r.userId);
  res.json({ tempPassword: r.tempPassword });
}));

// Moderasi foto/video privat host (dikirim di chat, dibuka pengguna dengan koin): lihat dan hapus yang melanggar
router.get('/private-media', wrap(async (req, res) => {
  res.json(await require('../services/mediaReview').list(req.query.status));
}));
router.get('/private-media/:id/file', wrap(async (req, res) => {
  const { file } = await require('../services/mediaReview').filePath(req.params.id);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File tidak ditemukan' } });
  });
}));
router.post('/private-media/:id/reject', wrap(async (req, res) => {
  await require('../services/mediaReview').reject(req.params.id, (req.body || {}).reason);
  res.json({ ok: true });
}));

// Gaji pokok host
router.get('/salary', wrap(async (req, res) => {
  res.json(await require('../services/salary').adminList());
}));
router.get('/salary/risk', wrap(async (req, res) => {
  res.json(await require('../services/salary').risk(Number(req.query.reward) || 0, Number(req.query.target) || 0));
}));
router.post('/salary', wrap(async (req, res) => {
  res.status(201).json(await require('../services/salary').adminSave(req.user.id, req.body.hostId, req.body || {}, { create: true }));
}));
router.patch('/salary/:hostId', wrap(async (req, res) => {
  res.json(await require('../services/salary').adminSave(req.user.id, req.params.hostId, req.body || {}, { create: false }));
}));
router.delete('/salary/:hostId', wrap(async (req, res) => {
  await require('../services/salary').adminRemove(req.params.hostId);
  res.json({ ok: true });
}));

// Moderasi momen: foto host harus disetujui dulu
router.get('/moments', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const { rows } = await db.query(
    `SELECT m.id, m.body, m.image_url, m.status, m.reject_reason, m.created_at, m.views, u.id AS host_id, u.display_name,
       (SELECT COUNT(*) FROM moment_likes l WHERE l.moment_id = m.id)::int AS likes
     FROM moments m JOIN users u ON u.id = m.host_id WHERE m.status = $1 ORDER BY m.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
    [status]
  );
  res.json(rows.map((r) => ({ id: Number(r.id), body: r.body, imageUrl: r.image_url, status: r.status, rejectReason: r.reject_reason, createdAt: r.created_at, views: r.views, likes: r.likes, hostId: Number(r.host_id), displayName: r.display_name })));
}));

router.post('/moments/:id/approve', wrap(async (req, res) => {
  const { rows } = await db.query(`UPDATE moments SET status = 'approved', reject_reason = NULL WHERE id = $1 RETURNING host_id`, [v.id(req.params.id)]);
  if (!rows.length) throw notFound('Momen tidak ditemukan');
  await notify(Number(rows[0].host_id), 'moment', 'Foto momen disetujui', 'Momenmu sudah disetujui dan tampil ke pengguna.');
  res.json({ ok: true });
}));

// Tolak: foto langsung dihapus dari server; teks (jika ada) tetap tersimpan sebagai riwayat
router.post('/moments/:id/reject', wrap(async (req, res) => {
  const reason = v.str(req.body.reason, 'Alasan', { min: 3, max: 200 });
  const { rows } = await db.query(
    `UPDATE moments m SET status = 'rejected', reject_reason = $2, image_url = NULL
     FROM (SELECT id, image_url FROM moments WHERE id = $1) o WHERE m.id = o.id RETURNING o.image_url, m.host_id`,
    [v.id(req.params.id), reason]
  );
  if (!rows.length) throw notFound('Momen tidak ditemukan');
  if (rows[0].image_url) await require('../lib/storage').remove(rows[0].image_url);
  await notify(Number(rows[0].host_id), 'moment', 'Foto momen ditolak', `Alasan: ${reason}`);
  res.json({ ok: true });
}));

router.delete('/moments/:id', wrap(async (req, res) => {
  const { rows } = await db.query(`DELETE FROM moments WHERE id = $1 RETURNING image_url`, [v.id(req.params.id)]);
  if (rows.length && rows[0].image_url) await require('../lib/storage').remove(rows[0].image_url);
  res.json({ ok: true });
}));

router.delete('/packages/:id', wrap(async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM coin_packages WHERE id = $1`, [v.id(req.params.id)]);
  if (!rowCount) throw notFound('Paket tidak ditemukan');
  res.json({ ok: true });
}));

// Kartu margin: untung/rugi platform per koin dengan pengaturan saat ini
router.get('/margin', wrap(async (req, res) => {
  res.json(await economy.currentMargin());
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
    balance: Number(a.balance ?? 0),
    username: a.username || null,
    loginSet: !!a.password_hash,
    countryCode: a.country_code ? a.country_code.trim() : null,
    contact: a.contact,
    hosts: a.hosts === undefined ? undefined : Number(a.hosts),
    createdAt: a.created_at,
  };
}

async function checkRate(rate) {
  if (rate === undefined) return;
  const n = Number(rate);
  if (!(n >= 0 && n <= 1)) {
    throw badRequest('Komisi agency harus 0 sampai 1 (persen dari penghasilan host, dibayar dari bagian app)');
  }
}

// Atur login panel agency (username, password awal / reset, negara untuk metode penarikan)
router.put('/agencies/:id/login', wrap(async (req, res) => {
  await agencyPanel.adminSetLogin(req.params.id, req.body || {});
  res.json({ ok: true });
}));

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
  await economy.guard(db, { agencyRate: b.commissionRate ?? economy.DEFAULT_AGENCY_RATE });
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
  if (b.commissionRate !== undefined) await economy.guard(db, { agencyRate: b.commissionRate });
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
  const { rows } = await db.query(
    `UPDATE user_photos SET status = 'approved', reject_reason = NULL WHERE id = $1 RETURNING user_id`,
    [v.id(req.params.id)]
  );
  if (!rows.length) throw notFound('Foto tidak ditemukan');
  await notify(Number(rows[0].user_id), 'photo', 'Foto album disetujui', 'Foto albummu sudah disetujui dan tampil ke pengguna.');
  res.json({ ok: true });
}));

router.post('/photos/:id/reject', wrap(async (req, res) => {
  const reason = v.str(req.body.reason, 'Alasan', { min: 3, max: 200 });
  const { rows } = await db.query(
    `UPDATE user_photos SET status = 'rejected', reject_reason = $2 WHERE id = $1 RETURNING user_id`,
    [v.id(req.params.id), reason]
  );
  if (!rows.length) throw notFound('Foto tidak ditemukan');
  await notify(Number(rows[0].user_id), 'photo', 'Foto album ditolak', `Alasan: ${reason}`);
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
  await notify(userId, 'avatar', 'Foto profil disetujui', 'Foto profil barumu sudah disetujui dan tampil ke pengguna.');
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
  await notify(userId, 'avatar', 'Foto profil ditolak', 'Foto profil barumu tidak disetujui. Silakan unggah foto lain.');
  res.json({ ok: true });
}));

module.exports = router;

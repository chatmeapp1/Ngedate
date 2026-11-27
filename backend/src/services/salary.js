const db = require('../db');
const wallet = require('./wallet');
const realtime = require('../realtime');
const { notify } = require('./notifications');
const { currentMargin } = require('./economy');
const { notFound, badRequest } = require('../lib/errors');

/**
 * Gaji pokok host (program per host, ditambahkan admin). Per MINGGU (Senin-Minggu, WIB), host dibayar OTOMATIS
 * sebesar `reward` diamond bila semuanya terpenuhi:
 *   - online di app >= minutes_per_day menit pada >= days_required hari yang berbeda
 *   - penghasilan diamond dari pesan chat + gift minggu ini >= income_target
 * Waktu online dicatat saat koneksi realtime host terbuka (app dibuka di layar depan).
 *
 * Penghasilan yang dihitung: diamond dari chat + gift SEJAK host didaftarkan (enrolled_at) pada minggu ini,
 * dikurangi diamond yang sudah ditarik (withdraw), dan tidak boleh melebihi saldo diamond host saat ini.
 * Jadi diamond yang sudah ditarik atau diperoleh sebelum didaftarkan tidak ikut terhitung.
 */
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;
const WEEK_SQL = `date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')::date`;
const INCOME_REASONS = `('chat_income', 'gift_income')`;
// Awal hitungan: Senin 00:00 WIB minggu ini, atau saat host didaftarkan bila lebih baru
const START_SQL = `GREATEST((date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta', s.enrolled_at)`;

/** Tambah detik online untuk host program yang sedang tersambung. Dipanggil tiap beberapa detik oleh job. */
async function tick(seconds, onlineIds = realtime.onlineUserIds()) {
  if (!onlineIds.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO host_online_daily (host_id, day, seconds)
     SELECT host_id, ${TODAY_SQL}, $2 FROM host_salary WHERE active AND host_id = ANY($1::bigint[])
     ON CONFLICT (host_id, day) DO UPDATE SET seconds = host_online_daily.seconds + EXCLUDED.seconds`,
    [onlineIds, seconds]
  );
  return rowCount;
}

async function progress(client, hostId) {
  const { rows } = await client.query(
    `SELECT s.*, ${WEEK_SQL}::text AS week_start,
       EXTRACT(EPOCH FROM (${WEEK_SQL}::timestamp + interval '7 days') - (now() AT TIME ZONE 'Asia/Jakarta'))::int AS week_ends_in,
       COALESCE((SELECT seconds FROM host_online_daily WHERE host_id = s.host_id AND day = ${TODAY_SQL}), 0) AS today_seconds,
       (SELECT COUNT(*) FROM host_online_daily d WHERE d.host_id = s.host_id AND d.day >= ${WEEK_SQL}
          AND d.seconds >= s.minutes_per_day * 60)::int AS valid_days,
       GREATEST(0, LEAST(
         (SELECT COALESCE(SUM(l.amount), 0) FROM ledger l WHERE l.user_id = s.host_id AND l.currency = 'diamond' AND l.amount > 0
            AND l.reason IN ${INCOME_REASONS} AND l.created_at >= ${START_SQL})
         - (SELECT COALESCE(SUM(w.diamonds), 0) FROM withdrawals w WHERE w.user_id = s.host_id AND w.status IN ('pending', 'paid')
            AND w.created_at >= ${START_SQL}),
         (SELECT diamonds FROM users WHERE id = s.host_id)))::bigint AS income,
       (SELECT created_at FROM host_salary_payouts p WHERE p.host_id = s.host_id AND p.week_start = ${WEEK_SQL}) AS paid_at
     FROM host_salary s WHERE s.host_id = $1`,
    [hostId]
  );
  return rows[0] || null;
}

const mapProgress = (r) => ({
  enrolled: true,
  active: r.active,
  minutesPerDay: r.minutes_per_day,
  daysRequired: r.days_required,
  incomeTarget: r.income_target,
  reward: r.reward,
  todayMinutes: Math.floor(Number(r.today_seconds) / 60),
  validDays: Math.min(r.valid_days, r.days_required),
  income: Number(r.income),
  weekStart: r.week_start,
  weekEndsIn: r.week_ends_in,
  paid: !!r.paid_at,
  paidAt: r.paid_at,
  met: r.valid_days >= r.days_required && Number(r.income) >= r.income_target,
});

/** Status untuk layar host. enrolled=false jika host tidak ikut program. */
async function status(client, hostId) {
  const r = await progress(client, hostId);
  if (!r || !r.active) return { enrolled: false };
  return mapProgress(r);
}

/** Bayar otomatis bila syarat minggu ini terpenuhi dan belum dibayar. Mengembalikan jumlah yang dibayar (0 jika tidak). */
async function evaluate(hostId) {
  const paid = await db.tx(async (client) => {
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [hostId]);
    const r = await progress(client, hostId);
    if (!r || !r.active || r.paid_at) return 0;
    const m = mapProgress(r);
    if (!m.met) return 0;
    const ins = await client.query(
      `INSERT INTO host_salary_payouts (host_id, week_start, reward) VALUES ($1, ${WEEK_SQL}, $2) ON CONFLICT DO NOTHING`,
      [hostId, r.reward]
    );
    if (!ins.rowCount) return 0;
    if (r.reward > 0) await wallet.creditDiamonds(client, hostId, r.reward, 'salary_reward', { type: 'salary', note: r.week_start });
    return r.reward;
  });
  if (paid > 0) {
    await notify(hostId, 'salary', 'Gaji pokok diterima', `${paid.toLocaleString('id-ID')} diamond gaji pokok minggu ini sudah masuk ke saldo kamu.`);
    const b = await wallet.balances(db, hostId);
    if (b) realtime.emitTo(hostId, 'wallet:update', b);
  }
  return paid;
}

/** Periksa semua host program (job berkala), supaya host yang sedang offline pun tetap dibayar. */
async function sweep() {
  const { rows } = await db.query(`SELECT host_id FROM host_salary WHERE active`);
  let total = 0;
  for (const r of rows) total += (await evaluate(Number(r.host_id))) > 0 ? 1 : 0;
  return total;
}

// ---------------- Admin ----------------
const clampInt = (n, name, min, max) => {
  const x = Number(n);
  if (!Number.isInteger(x) || x < min || x > max) throw badRequest(`${name} harus bilangan bulat ${min}-${max}`);
  return x;
};

function parseConfig(b, base = {}) {
  return {
    minutes_per_day: clampInt(b.minutesPerDay ?? base.minutes_per_day ?? 120, 'Menit online per hari', 1, 1440),
    days_required: clampInt(b.daysRequired ?? base.days_required ?? 5, 'Jumlah hari', 1, 7),
    income_target: clampInt(b.incomeTarget ?? base.income_target ?? 70000, 'Target pendapatan', 0, 1e9),
    reward: clampInt(b.reward ?? base.reward ?? 70000, 'Gaji pokok', 0, 1e9),
  };
}

/**
 * Perkiraan untung/rugi app per host per minggu jika host hanya memenuhi target lewat satu jalur.
 * Rugi = gaji (diamond x nilai Rp) - untung app dari koin yang dibelanjakan untuk mencapai target (skenario potongan Play 30%).
 */
async function risk(reward, target) {
  const m = await currentMargin(db);
  const salaryRp = reward * m.diamondRp;
  const path = (share) => {
    if (!(share > 0) || target <= 0) return { coins: 0, marginRp: 0, lossRp: salaryRp };
    const coins = target / share;
    const marginRp = coins * (m.worst.net - share * (1 + m.agencyRate) * m.diamondRp);
    return { coins, marginRp, lossRp: salaryRp - marginRp };
  };
  const chat = path(m.chatShare);
  const gift = path(m.giftShare);
  return {
    salaryRp: Math.round(salaryRp),
    chatOnly: { coins: Math.round(chat.coins), marginRp: Math.round(chat.marginRp), lossRp: Math.round(chat.lossRp) },
    giftOnly: { coins: Math.round(gift.coins), marginRp: Math.round(gift.marginRp), lossRp: Math.round(gift.lossRp) },
    risky: chat.lossRp > 0,
  };
}

async function adminList() {
  const { rows } = await db.query(`SELECT host_id FROM host_salary ORDER BY active DESC, created_at DESC`);
  const out = [];
  for (const r of rows) {
    const p = await progress(db, Number(r.host_id));
    const { rows: u } = await db.query(`SELECT display_name, username FROM users WHERE id = $1`, [r.host_id]);
    out.push({ hostId: Number(r.host_id), displayName: u[0].display_name, username: u[0].username, ...mapProgress(p) });
  }
  return out;
}

async function adminSave(adminId, hostIdRaw, body, { create }) {
  const hostId = clampInt(hostIdRaw, 'ID host', 1, 1e12);
  const { rows: u } = await db.query(`SELECT role, host_status FROM users WHERE id = $1`, [hostId]);
  if (!u.length || u[0].role !== 'host') throw notFound('Host tidak ditemukan');
  const { rows: ex } = await db.query(`SELECT * FROM host_salary WHERE host_id = $1`, [hostId]);
  if (create && ex.length && ex[0].active) throw badRequest('Host ini sudah ikut program gaji pokok', 'ALREADY_ENROLLED');
  if (!create && !ex.length) throw notFound('Host belum ikut program gaji pokok');
  const cfg = parseConfig(body, ex[0]);
  const rk = await risk(cfg.reward, cfg.income_target);
  if (rk.risky && body.force !== true) {
    const e = badRequest(
      `Berisiko rugi: gaji ${cfg.reward.toLocaleString('id-ID')} diamond (±Rp ${rk.salaryRp.toLocaleString('id-ID')}) bisa melebihi untung app bila target dicapai hanya lewat chat ` +
        `(rugi ±Rp ${rk.chatOnly.lossRp.toLocaleString('id-ID')} per host per minggu). Jika lewat gift, app tetap untung ±Rp ${(-rk.giftOnly.lossRp).toLocaleString('id-ID')}.`,
      'LOSS_RISK'
    );
    throw e;
  }
  await db.query(
    `INSERT INTO host_salary (host_id, active, minutes_per_day, days_required, income_target, reward, created_by)
     VALUES ($1, true, $2, $3, $4, $5, $6)
     ON CONFLICT (host_id) DO UPDATE SET minutes_per_day = $2, days_required = $3, income_target = $4, reward = $5, updated_at = now(),
       -- didaftarkan ulang setelah keluar: hitungan penghasilan mulai dari sekarang
       enrolled_at = CASE WHEN host_salary.active THEN host_salary.enrolled_at ELSE now() END,
       active = true`,
    [hostId, cfg.minutes_per_day, cfg.days_required, cfg.income_target, cfg.reward, adminId]
  );
  if (create) await notify(hostId, 'salary', 'Gaji pokok aktif', 'Kamu ikut program gaji pokok. Buka menu Gaji pokok di Saya untuk melihat targetnya.');
  return { ...(await status(db, hostId)), risk: rk };
}

async function adminRemove(hostIdRaw) {
  const { rowCount } = await db.query(`UPDATE host_salary SET active = false, updated_at = now() WHERE host_id = $1 AND active`, [clampInt(hostIdRaw, 'ID host', 1, 1e12)]);
  if (!rowCount) throw notFound('Host tidak ikut program');
}

module.exports = { tick, status, evaluate, sweep, risk, adminList, adminSave, adminRemove };

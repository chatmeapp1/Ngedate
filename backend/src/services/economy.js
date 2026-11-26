const db = require('../db');
const { getSettings } = require('./settings');
const { ApiError } = require('../lib/errors');

/**
 * Pengaman anti-rugi. Menghitung untung/rugi platform per 1 koin yang dibelanjakan pengguna:
 *   bersih   = harga jual per koin, dikurangi PPN dan potongan Google Play
 *   bayar    = bagian host x (1 + komisi agency) x nilai Rupiah 1 diamond   (komisi agency = % dari penghasilan host)
 *   untung   = bersih - bayar
 * Dihitung untuk skenario terburuk (potongan Play 30%) dan terbaik (15%). Angka PPN & potongan adalah perkiraan.
 * Belum termasuk pajak penghasilan, server, dan promosi.
 */
const VAT = 0.11;
const PLAY_FEE_WORST = 0.3;
const PLAY_FEE_BEST = 0.15;
const DEFAULT_AGENCY_RATE = 0.1; // agency baru dibuat dengan komisi ini

function compute({ pricePerCoin, hostShare, agencyRate, diamondRp }, playFee) {
  const net = (pricePerCoin / (1 + VAT)) * (1 - playFee);
  const payout = hostShare * (1 + agencyRate) * diamondRp;
  const profit = net - payout;
  return { net, payout, profit, profitPct: pricePerCoin > 0 ? (profit / pricePerCoin) * 100 : 0 };
}

/**
 * Margin saat ini. overrides.settings = pengaturan yang akan disimpan, overrides.agencyRate = komisi agency yang akan dipakai.
 * Harga jual yang dipakai adalah paket aktif TERMURAH per koin (Rupiah maupun USD).
 */
async function currentMargin(client = db, overrides = {}) {
  const s = { ...(await getSettings(client)), ...(overrides.settings || {}) };
  const usdIdr = Number(s.withdraw_usd_idr);
  const { rows: pk } = await client.query(`SELECT coins, price_idr, price_usd_cents FROM coin_packages WHERE active`);
  let price = Infinity;
  for (const p of pk) {
    const coins = Number(p.coins);
    price = Math.min(price, Number(p.price_idr) / coins, ((p.price_usd_cents / 100) * usdIdr) / coins);
  }
  if (!Number.isFinite(price)) price = Number(s.coin_price_idr);

  const { rows: ag } = await client.query(`SELECT COALESCE(MAX(commission_rate), 0) AS m FROM agencies WHERE active`);
  const agencyRate = Math.max(DEFAULT_AGENCY_RATE, Number(ag[0].m), Number(overrides.agencyRate || 0));
  const chatShare = Number(s.host_share);
  const giftShare = Number(s.gift_host_share);
  const { rows: gm } = await client.query(`SELECT COALESCE(MAX(host_multiplier), 1) AS m FROM gifts WHERE active`);
  const giftMultiplier = Number(gm[0].m);
  // Bagian host terbesar dari semua jalur: chat berbayar, gift biasa, gift dengan pengali
  const hostShare = Math.max(chatShare, giftShare * giftMultiplier);
  const diamondRp = usdIdr / Number(s.withdraw_diamonds_per_usd);

  const input = { pricePerCoin: price, hostShare, agencyRate, diamondRp };
  return {
    pricePerCoin: price,
    hostShare,
    chatShare,
    giftShare,
    giftMultiplier,
    agencyRate,
    diamondRp,
    worst: { playFee: PLAY_FEE_WORST, ...compute(input, PLAY_FEE_WORST) },
    best: { playFee: PLAY_FEE_BEST, ...compute(input, PLAY_FEE_BEST) },
  };
}

const rp = (n) => `Rp ${n.toFixed(2).replace('.', ',')}`;

/**
 * Tolak perubahan yang membuat platform rugi (atau menambah kerugian yang sudah ada).
 * `apply` dijalankan di antara pengukuran "sebelum" dan "sesudah" (dipakai saat perubahan ditulis di transaksi yang sama).
 */
async function guard(client, overrides, apply) {
  const before = await currentMargin(client);
  if (apply) await apply();
  const after = await currentMargin(client, apply ? {} : overrides);
  if (after.worst.profit < 0 && after.worst.profit < before.worst.profit - 1e-9) {
    throw new ApiError(
      400,
      'NEGATIVE_MARGIN',
      `Pengaturan ini membuat app rugi ${rp(-after.worst.profit)} per koin (skenario potongan Google Play 30%). ` +
        `Harga jual terendah ${rp(after.pricePerCoin)}/koin → bersih ${rp(after.worst.net)}, sedangkan bayar host + agency ${rp(after.worst.payout)}. ` +
        'Naikkan harga, turunkan bagian host / komisi agency, atau turunkan nilai diamond.',
      { margin: after.worst }
    );
  }
  return after;
}

module.exports = { currentMargin, guard, DEFAULT_AGENCY_RATE };

const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const { wrap } = require('../lib/errors');

/**
 * Papan peringkat:
 *   hosts   = host dengan penghasilan diamond terbanyak (chat, gift, kartu gratis, buka media)
 *   senders = pengguna yang paling banyak membelanjakan koin untuk gift dan buka media privat
 *   gifts   = gift tunggal bernilai terbesar (pengirim -> gift -> host), seperti papan "hadiah"
 * period: week (7 hari terakhir) | all (semua waktu). Dihitung ulang paling cepat tiap 30 detik.
 */
const router = express.Router();
const LIMIT = 20;
const cache = new Map();

const INCOME = `('chat_income', 'gift_income', 'free_card_income', 'media_income')`;

async function computeGifts(period) {
  const since = period === 'week' ? `AND m.created_at > now() - interval '7 days'` : '';
  const { rows } = await db.query(
    `SELECT m.id, m.price AS score, m.gift_count AS count, m.created_at,
            g.name AS gift_name, g.image_url AS gift_image, g.icon AS gift_icon,
            su.id AS sender_id, su.display_name AS sender_name, su.avatar_url AS sender_avatar,
            hu.id AS host_id, hu.display_name AS host_name, hu.avatar_url AS host_avatar
     FROM messages m
     JOIN gifts g ON g.id = m.gift_id
     JOIN conversations c ON c.id = m.conversation_id
     JOIN users su ON su.id = m.sender_id
     JOIN users hu ON hu.id = c.host_id
     WHERE m.type = 'gift' AND su.status = 'active' AND hu.status = 'active' ${since}
     ORDER BY m.price DESC, m.id DESC LIMIT ${LIMIT}`
  );
  return rows;
}

async function compute(type, period) {
  if (type === 'gifts') return computeGifts(period);
  const since = period === 'week' ? `AND {t} > now() - interval '7 days'` : '';
  if (type === 'hosts') {
    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.avatar_url, u.verified, u.country_code, SUM(l.amount)::bigint AS score
       FROM ledger l JOIN users u ON u.id = l.user_id
       WHERE l.currency = 'diamond' AND l.amount > 0 AND l.reason IN ${INCOME}
         AND u.role = 'host' AND u.status = 'active' AND u.host_status = 'approved' ${since.replace('{t}', 'l.created_at')}
       GROUP BY u.id ORDER BY score DESC, u.id LIMIT ${LIMIT}`
    );
    return rows;
  }
  const { rows } = await db.query(
    `WITH spent AS (
       SELECT m.sender_id AS user_id, m.price AS amount, m.created_at AS at FROM messages m WHERE m.type = 'gift'
       UNION ALL
       SELECT mu.user_id, mu.paid, mu.created_at FROM media_unlocks mu WHERE mu.paid > 0
     )
     SELECT u.id, u.display_name, u.avatar_url, u.verified, u.country_code, SUM(s.amount)::bigint AS score
     FROM spent s JOIN users u ON u.id = s.user_id
     WHERE u.status = 'active' AND u.role = 'user' ${since.replace('{t}', 's.at')}
     GROUP BY u.id ORDER BY score DESC, u.id LIMIT ${LIMIT}`
  );
  return rows;
}

router.get('/', wrap(async (req, res) => {
  const type = v.str(req.query.type ?? 'hosts', 'type', { pattern: /^(hosts|senders|gifts)$/ });
  const period = v.str(req.query.period ?? 'week', 'period', { pattern: /^(week|all)$/ });
  const key = `${type}:${period}`;
  const hit = cache.get(key);
  let rows;
  if (hit && Date.now() - hit.at < 30_000 && process.env.NODE_ENV !== 'test') rows = hit.rows;
  else {
    rows = await compute(type, period);
    cache.set(key, { at: Date.now(), rows });
  }
  if (type === 'gifts') {
    return res.json({
      type,
      period,
      items: rows.map((r, i) => ({
        rank: i + 1,
        messageId: Number(r.id),
        score: Number(r.score),
        count: Number(r.count || 1),
        at: r.created_at,
        gift: { name: r.gift_name, imageUrl: r.gift_image, icon: r.gift_icon },
        sender: { id: Number(r.sender_id), displayName: r.sender_name, avatarUrl: r.sender_avatar },
        host: { id: Number(r.host_id), displayName: r.host_name, avatarUrl: r.host_avatar },
      })),
    });
  }
  res.json({
    type,
    period,
    items: rows.map((r, i) => ({
      rank: i + 1,
      id: Number(r.id),
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      verified: !!r.verified,
      countryCode: r.country_code ? r.country_code.trim() : null,
      score: Number(r.score),
    })),
  });
}));

module.exports = router;

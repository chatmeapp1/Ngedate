const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
  });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  // Token agency tidak boleh dipakai sebagai token pengguna (id agency bisa sama dengan id pengguna)
  if (payload.typ === 'agency') throw new jwt.JsonWebTokenError('token agency');
  return { id: Number(payload.sub), role: payload.role };
}

// Token khusus panel agency (masa berlaku 12 jam, tanpa refresh token)
function signAgencyToken(agency) {
  return jwt.sign({ sub: String(agency.id), typ: 'agency' }, config.jwtSecret, { expiresIn: '12h' });
}

function verifyAgencyToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload.typ !== 'agency') throw new jwt.JsonWebTokenError('bukan token agency');
  return { id: Number(payload.sub), issuedAt: payload.iat };
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Refresh token acak (bukan JWT), disimpan dalam bentuk hash di database
async function issueRefreshToken(userId, client = db) {
  const token = crypto.randomBytes(48).toString('base64url');
  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, hash(token), config.refreshTokenDays]
  );
  return token;
}

// Tukar refresh token lama dengan yang baru (rotasi). Mengembalikan userId atau null.
async function rotateRefreshToken(token) {
  return db.tx(async (client) => {
    const { rows } = await client.query(
      `DELETE FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING user_id`,
      [hash(token)]
    );
    if (!rows.length) return null;
    const userId = Number(rows[0].user_id);
    const next = await issueRefreshToken(userId, client);
    return { userId, refreshToken: next };
  });
}

async function revokeRefreshToken(token) {
  await db.query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [hash(token)]);
}

module.exports = { signAgencyToken, verifyAgencyToken, signAccessToken, verifyAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken };

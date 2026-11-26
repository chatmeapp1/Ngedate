const db = require('../db');
const { verifyAccessToken } = require('../lib/tokens');
const { unauthorized, forbidden } = require('../lib/errors');

/**
 * Wajib login. Status akun dicek ke database supaya akun yang di-suspend
 * langsung tidak bisa dipakai walaupun token-nya masih berlaku.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw unauthorized();
    let payload;
    try {
      payload = verifyAccessToken(header.slice(7));
    } catch (e) {
      throw unauthorized(e.name === 'TokenExpiredError' ? 'Sesi habis' : 'Token tidak valid',
        e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
    }
    const { rows } = await db.query(`SELECT id, role, status FROM users WHERE id = $1`, [payload.id]);
    if (!rows.length) throw unauthorized('Akun tidak ditemukan');
    if (rows[0].status === 'deleted') throw forbidden('Akun sudah dihapus', 'ACCOUNT_DELETED');
    if (rows[0].status !== 'active') throw forbidden('Akun ditangguhkan', 'SUSPENDED');
    req.user = { id: Number(rows[0].id), role: rows[0].role };
    next();
  } catch (err) {
    next(err);
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
  next();
};

module.exports = { authenticate, requireRole };

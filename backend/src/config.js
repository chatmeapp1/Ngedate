require('dotenv').config();

function required(name, fallbackForDev) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Environment variable ${name} wajib diisi di production`);
  }
  return fallbackForDev;
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL', 'postgres://postgres@127.0.0.1:5432/ngedate'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: required('JWT_SECRET', 'dev-only-access-secret'),
  refreshSecret: required('REFRESH_TOKEN_SECRET', 'dev-only-refresh-secret'),
  accessTokenTtl: '15m',
  refreshTokenDays: 30,
  // Interval pengecekan pesan yang belum dibalas (refund otomatis)
  refundJobIntervalMs: Number(process.env.REFUND_JOB_INTERVAL_MS || 60_000),
};

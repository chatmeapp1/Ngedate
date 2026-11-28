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
  // Live stream: media server (MediaMTX). Kosongkan LIVE_MEDIA_API untuk mematikan sinkronisasi.
  liveMediaApi: process.env.LIVE_MEDIA_API === undefined ? 'http://127.0.0.1:9997' : process.env.LIVE_MEDIA_API,
  liveHlsUpstream: process.env.LIVE_HLS_UPSTREAM || 'http://127.0.0.1:8888',
  // Alamat RTMP yang ditampilkan ke host (HP/PC host harus bisa menjangkaunya), mis. rtmp://192.168.1.5:1935/live
  liveRtmpPublic: process.env.LIVE_RTMP_PUBLIC || 'rtmp://127.0.0.1:1935/live',
  // IP tambahan (pisah koma) yang boleh memanggil /api/live-media/auth selain localhost
  liveAuthAllow: (process.env.LIVE_AUTH_ALLOW || '').split(',').map((x) => x.trim()).filter(Boolean),
  refundJobIntervalMs: Number(process.env.REFUND_JOB_INTERVAL_MS || 60_000),
};

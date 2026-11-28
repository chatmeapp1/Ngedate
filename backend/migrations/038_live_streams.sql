-- Live stream (tahap 1): host siaran lewat RTMP ke media server (MediaMTX), penonton memutar LL-HLS
CREATE TABLE IF NOT EXISTS live_streams (
  id              BIGSERIAL PRIMARY KEY,
  host_id         BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title           VARCHAR(80) NOT NULL DEFAULT '',
  public_id       VARCHAR(16) NOT NULL UNIQUE,      -- nama path di media server (publik, dipakai penonton)
  secret_hash     TEXT        NOT NULL,             -- sha256 kunci siaran host (rahasia, hanya untuk publish)
  status          VARCHAR(10) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'live', 'ended')),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,                      -- siaran terputus (menunggu tersambung kembali)
  ended_reason    VARCHAR(12),                      -- host | admin | dropped | timeout
  peak_viewers    INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Satu host hanya boleh punya satu siaran aktif
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_active ON live_streams (host_id) WHERE status <> 'ended';
CREATE INDEX IF NOT EXISTS live_streams_status_idx ON live_streams (status, started_at DESC);

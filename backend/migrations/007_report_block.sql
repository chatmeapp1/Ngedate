-- Blokir antar pengguna & laporan pelanggaran

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id BIGINT      NOT NULL REFERENCES users (id),
  blocked_id BIGINT      NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);

CREATE TABLE IF NOT EXISTS reports (
  id              BIGSERIAL PRIMARY KEY,
  reporter_id     BIGINT       NOT NULL REFERENCES users (id),
  target_id       BIGINT       NOT NULL REFERENCES users (id),
  conversation_id BIGINT       REFERENCES conversations (id),
  message_id      BIGINT       REFERENCES messages (id),
  reason          VARCHAR(20)  NOT NULL,
  details         VARCHAR(500),
  -- Salinan beberapa pesan terakhir saat dilaporkan (hanya dilihat admin)
  evidence        JSONB,
  status          VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  action          VARCHAR(10),
  admin_note      VARCHAR(300),
  reviewed_by     BIGINT       REFERENCES users (id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, id DESC);
CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_id);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_id, created_at DESC);

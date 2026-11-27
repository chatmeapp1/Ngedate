-- Match: host yang dilewati (geser kiri) disembunyikan dari tumpukan kartu untuk sementara
CREATE TABLE IF NOT EXISTS match_skips (
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  host_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, host_id)
);

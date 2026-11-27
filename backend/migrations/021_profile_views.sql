-- Siapa yang melihat profil host (untuk daftar "Orang asing" di Pesan akun host)
CREATE TABLE IF NOT EXISTS profile_views (
  host_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  viewer_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  views     INTEGER     NOT NULL DEFAULT 1,
  first_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS profile_views_host_idx ON profile_views (host_id, last_at DESC);

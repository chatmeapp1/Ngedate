-- Momen: postingan foto/teks dari host, dilihat semua pengguna
CREATE TABLE IF NOT EXISTS moments (
  id         BIGSERIAL PRIMARY KEY,
  host_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT,
  image_url  TEXT,
  views      INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR image_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS moments_host_idx ON moments (host_id, id DESC);
CREATE INDEX IF NOT EXISTS moments_views_idx ON moments (views DESC, id DESC);

CREATE TABLE IF NOT EXISTS moment_likes (
  moment_id BIGINT      NOT NULL REFERENCES moments (id) ON DELETE CASCADE,
  user_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (moment_id, user_id)
);

CREATE TABLE IF NOT EXISTS moment_comments (
  id         BIGSERIAL PRIMARY KEY,
  moment_id  BIGINT      NOT NULL REFERENCES moments (id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moment_comments_idx ON moment_comments (moment_id, id);

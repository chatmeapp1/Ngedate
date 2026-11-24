-- =====================================================================
-- Job 2: negara, album foto, ikuti, suka
-- =====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code CHAR(2);
CREATE INDEX IF NOT EXISTS users_country_idx ON users (country_code) WHERE role = 'host';

-- Album foto (host & user)
CREATE TABLE IF NOT EXISTS user_photos (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_photos_user_idx ON user_photos (user_id, sort_order, id);

-- Ikuti (siapa saja bisa mengikuti siapa saja)
CREATE TABLE IF NOT EXISTS follows (
  follower_id  BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followee_id  BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_id);

-- Suka (user menyukai host)
CREATE TABLE IF NOT EXISTS likes (
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id),
  CHECK (user_id <> target_id)
);
CREATE INDEX IF NOT EXISTS likes_target_idx ON likes (target_id);

-- Untuk dinding hadiah & host populer
CREATE INDEX IF NOT EXISTS messages_gift_idx ON messages (conversation_id) WHERE type = 'gift';

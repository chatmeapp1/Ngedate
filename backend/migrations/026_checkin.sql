-- Check-in harian (7 hari berurutan, lalu mengulang). Satu baris per pengguna per hari (WIB).
CREATE TABLE IF NOT EXISTS user_checkins (
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        DATE        NOT NULL,
  streak_day INTEGER     NOT NULL CHECK (streak_day BETWEEN 1 AND 7),
  coins      INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

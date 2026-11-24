-- =====================================================================
-- Ngedate: skema awal
-- Semua saldo memakai BIGINT dan tidak boleh negatif (CHECK >= 0).
-- Setiap perubahan saldo dicatat di tabel ledger.
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  username        VARCHAR(30)  NOT NULL UNIQUE,
  email           VARCHAR(120) UNIQUE,
  password_hash   TEXT         NOT NULL,
  display_name    VARCHAR(50)  NOT NULL,
  avatar_url      TEXT,
  bio             VARCHAR(500),
  gender          VARCHAR(10)  CHECK (gender IN ('male', 'female', 'other')),
  birth_date      DATE,
  role            VARCHAR(10)  NOT NULL DEFAULT 'user'   CHECK (role IN ('user', 'host', 'admin')),
  status          VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  coins           BIGINT       NOT NULL DEFAULT 0 CHECK (coins >= 0),     -- dibeli user, dipakai chat & gift
  diamonds        BIGINT       NOT NULL DEFAULT 0 CHECK (diamonds >= 0),  -- penghasilan host
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role, status);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

-- Pengaturan milik host: tarif chat & syarat buka WhatsApp
CREATE TABLE IF NOT EXISTS host_profiles (
  user_id              BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  chat_price           INTEGER     NOT NULL DEFAULT 100     CHECK (chat_price >= 0),
  wa_enabled           BOOLEAN     NOT NULL DEFAULT false,
  wa_number            VARCHAR(20),                          -- hanya dikirim ke user yang sudah membuka
  wa_unlock_threshold  BIGINT      NOT NULL DEFAULT 1000000 CHECK (wa_unlock_threshold > 0),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gifts (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(50) NOT NULL,
  price          INTEGER     NOT NULL CHECK (price > 0),
  image_url      TEXT,
  animation_url  TEXT,       -- Lottie / SVGA
  sound_url      TEXT,
  category       VARCHAR(20) NOT NULL DEFAULT 'normal',
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Satu percakapan per pasangan user <-> host
CREATE TABLE IF NOT EXISTS conversations (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT      NOT NULL REFERENCES users (id),
  host_id               BIGINT      NOT NULL REFERENCES users (id),
  gift_total            BIGINT      NOT NULL DEFAULT 0,  -- total koin gift dari user ke host (untuk buka WA)
  wa_unlocked_at        TIMESTAMPTZ,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  VARCHAR(120),
  user_unread           INTEGER     NOT NULL DEFAULT 0,
  host_unread           INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, host_id),
  CHECK (user_id <> host_id)
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_host_idx ON conversations (host_id, last_message_at DESC);

-- payment_status:
--   free     = tidak berbayar (pesan host, pesan sistem, tarif 0)
--   held     = koin user ditahan, menunggu host membalas
--   paid     = host sudah membalas, koin dibagi ke host & platform
--   refunded = host tidak membalas dalam batas waktu, koin kembali ke user
CREATE TABLE IF NOT EXISTS messages (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT      NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id        BIGINT      REFERENCES users (id),       -- NULL untuk pesan sistem
  type             VARCHAR(10) NOT NULL CHECK (type IN ('text', 'gift', 'system')),
  body             TEXT,
  gift_id          INTEGER     REFERENCES gifts (id),
  gift_count       INTEGER,
  price            BIGINT      NOT NULL DEFAULT 0 CHECK (price >= 0),
  payment_status   VARCHAR(10) NOT NULL DEFAULT 'free' CHECK (payment_status IN ('free', 'held', 'paid', 'refunded')),
  settled_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_held_idx ON messages (created_at) WHERE payment_status = 'held';

-- Riwayat semua perubahan saldo user (koin & diamond)
CREATE TABLE IF NOT EXISTS ledger (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES users (id),
  currency       VARCHAR(10) NOT NULL CHECK (currency IN ('coin', 'diamond')),
  amount         BIGINT      NOT NULL,           -- positif = masuk, negatif = keluar
  balance_after  BIGINT      NOT NULL,
  reason         VARCHAR(30) NOT NULL,           -- chat_hold, chat_refund, chat_income, gift_send, gift_income, admin_topup, ...
  ref_type       VARCHAR(20),
  ref_id         BIGINT,
  note           VARCHAR(200),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger (user_id, id DESC);

-- Bagian platform dari chat & gift
CREATE TABLE IF NOT EXISTS platform_earnings (
  id          BIGSERIAL PRIMARY KEY,
  amount      BIGINT      NOT NULL,
  source      VARCHAR(20) NOT NULL,   -- chat, gift
  ref_type    VARCHAR(20),
  ref_id      BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pengaturan yang bisa diubah admin tanpa deploy ulang
CREATE TABLE IF NOT EXISTS settings (
  key         VARCHAR(50) PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES
  ('host_share',          '0.5'),        -- 50% untuk host
  ('chat_price_min',      '0'),
  ('chat_price_max',      '10000'),
  ('wa_threshold_min',    '10000'),
  ('wa_threshold_max',    '100000000'),
  ('reply_window_hours',  '24')          -- batas waktu host membalas sebelum koin dikembalikan
ON CONFLICT (key) DO NOTHING;

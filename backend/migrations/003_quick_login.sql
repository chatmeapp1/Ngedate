-- Login cepat: satu akun per perangkat.
-- Aplikasi membuat kode acak rahasia (device key) dan menyimpannya terenkripsi di HP.
-- Server hanya menyimpan hash-nya.
CREATE TABLE IF NOT EXISTS device_accounts (
  device_hash  TEXT        PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_accounts_user_idx ON device_accounts (user_id);

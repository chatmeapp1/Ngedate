-- Foto/video privat dari host: pengguna membuka dengan koin (harga ditentukan host saat mengirim).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_price   BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_file    VARCHAR(120);  -- nama file di folder privat (bukan URL publik)

CREATE TABLE IF NOT EXISTS media_unlocks (
  message_id BIGINT      PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES users (id),
  paid       BIGINT      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Penghasilan host dari buka media ikut dihitung di level host & "penghasilan hari ini"
DROP INDEX IF EXISTS ledger_income_idx;
CREATE INDEX IF NOT EXISTS ledger_income_idx ON ledger (user_id, created_at)
  WHERE currency = 'diamond' AND amount > 0 AND reason IN ('chat_income', 'gift_income', 'free_card_income', 'media_income');

-- Panel agency: login agency (username + password), saldo komisi (diamond) yang bisa ditarik, rekening & penarikan.
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS username            VARCHAR(40);
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS password_hash       TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Negara agency menentukan metode penarikan: ID -> bank/e-wallet (Rupiah), lainnya -> USDT TRC20 (USD)
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS country_code        CHAR(2) NOT NULL DEFAULT 'ID';
-- Saldo komisi yang belum ditarik (diamond). earnings_total tetap total seumur hidup.
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS balance             BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0);
UPDATE agencies SET balance = earnings_total;
CREATE UNIQUE INDEX IF NOT EXISTS agencies_username_idx ON agencies (lower(username)) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS agency_payout_accounts (
  agency_id      BIGINT      PRIMARY KEY REFERENCES agencies (id),
  kind           VARCHAR(10) NOT NULL CHECK (kind IN ('bank', 'ewallet', 'crypto')),
  provider       VARCHAR(30) NOT NULL,
  account_number VARCHAR(64) NOT NULL,
  account_name   VARCHAR(80),
  cooldown_until TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agency_withdrawals (
  id               BIGSERIAL PRIMARY KEY,
  agency_id        BIGINT      NOT NULL REFERENCES agencies (id),
  diamonds         BIGINT      NOT NULL CHECK (diamonds > 0),
  currency         VARCHAR(3)  NOT NULL CHECK (currency IN ('IDR', 'USD')),
  diamonds_per_usd INTEGER     NOT NULL,
  usd_idr          INTEGER     NOT NULL,
  gross            BIGINT      NOT NULL,
  fee              BIGINT      NOT NULL,
  net              BIGINT      NOT NULL,
  kind             VARCHAR(10) NOT NULL,
  provider         VARCHAR(30) NOT NULL,
  account_number   VARCHAR(64) NOT NULL,
  account_name     VARCHAR(80),
  status           VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  admin_note       VARCHAR(300),
  transfer_ref     VARCHAR(120),
  reviewed_by      BIGINT      REFERENCES users (id),
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agency_withdrawals_one_pending ON agency_withdrawals (agency_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agency_withdrawals_status_idx ON agency_withdrawals (status, id DESC);

-- Penarikan diamond host: rekening penarikan & pengajuan (dibayar manual oleh admin)

CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id        BIGINT      PRIMARY KEY REFERENCES users (id),
  kind           VARCHAR(10) NOT NULL CHECK (kind IN ('bank', 'ewallet')),
  provider       VARCHAR(30) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  account_name   VARCHAR(80) NOT NULL,
  -- Setelah rekening DIUBAH (bukan dibuat pertama kali), penarikan ditahan sampai waktu ini
  cooldown_until TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES users (id),
  diamonds       BIGINT      NOT NULL CHECK (diamonds > 0),
  rate_idr       INTEGER     NOT NULL,   -- rupiah per diamond saat pengajuan
  gross_idr      BIGINT      NOT NULL,
  fee_idr        BIGINT      NOT NULL,
  net_idr        BIGINT      NOT NULL,   -- yang ditransfer ke host
  -- Salinan rekening saat pengajuan (tidak berubah walau host mengganti rekening)
  kind           VARCHAR(10) NOT NULL,
  provider       VARCHAR(30) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  account_name   VARCHAR(80) NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  admin_note     VARCHAR(300),
  transfer_ref   VARCHAR(80),
  reviewed_by    BIGINT      REFERENCES users (id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Satu pengajuan yang menunggu per host
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_one_pending ON withdrawals (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals (status, id DESC);
CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawals (user_id, id DESC);

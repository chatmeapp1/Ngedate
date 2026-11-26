-- Penarikan diamond host: rekening/alamat penarikan & pengajuan (dibayar manual oleh admin)
--   Indonesia  -> bank / e-wallet, dibayar dalam Rupiah
--   Negara lain -> USDT jaringan TRC20, dibayar dalam USD
-- Jumlah uang disimpan dalam satuan terkecil: Rupiah utuh (IDR) atau sen (USD).

-- Model pembagian hasil berubah (host 30% bersih, agency 10% dari bagian app) dan kurs berbasis USD:
-- pengaturan lama dibuang supaya nilai awal yang baru berlaku.
DELETE FROM settings WHERE key IN ('host_share', 'withdraw_rate_idr', 'withdraw_min_diamonds', 'withdraw_fee_percent');

CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id        BIGINT      PRIMARY KEY REFERENCES users (id),
  kind           VARCHAR(10) NOT NULL CHECK (kind IN ('bank', 'ewallet', 'crypto')),
  provider       VARCHAR(30) NOT NULL,
  account_number VARCHAR(64) NOT NULL,        -- nomor rekening / nomor e-wallet / alamat TRC20
  account_name   VARCHAR(80),                 -- kosong untuk kripto
  -- Setelah rekening DIUBAH (bukan dibuat pertama kali), penarikan ditahan sampai waktu ini
  cooldown_until TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users (id),
  diamonds         BIGINT      NOT NULL CHECK (diamonds > 0),
  currency         VARCHAR(3)  NOT NULL CHECK (currency IN ('IDR', 'USD')),
  diamonds_per_usd INTEGER     NOT NULL,      -- kurs saat pengajuan
  usd_idr          INTEGER     NOT NULL,
  gross            BIGINT      NOT NULL,      -- satuan terkecil (Rupiah / sen)
  fee              BIGINT      NOT NULL,
  net              BIGINT      NOT NULL,      -- yang dikirim ke host
  -- Salinan rekening saat pengajuan (tidak berubah walau host mengganti rekening)
  kind             VARCHAR(10) NOT NULL,
  provider         VARCHAR(30) NOT NULL,
  account_number   VARCHAR(64) NOT NULL,
  account_name     VARCHAR(80),
  status           VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  admin_note       VARCHAR(300),
  transfer_ref     VARCHAR(120),              -- nomor referensi transfer / hash transaksi (TXID)
  reviewed_by      BIGINT      REFERENCES users (id),
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Satu pengajuan yang menunggu per host
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_one_pending ON withdrawals (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals (status, id DESC);
CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawals (user_id, id DESC);

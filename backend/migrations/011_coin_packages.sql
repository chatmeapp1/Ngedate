-- Paket koin untuk layar Top up (harga ditentukan admin).
-- Harga awal: Rp 2 per koin (18.000 koin = Rp 36.000). Harga USD memakai kurs Rp 17.000/USD.

-- Nilai awal baru: 1 diamond = Rp 1,55 (10.968 diamond per USD) dan harga jual koin Rp 2.
DELETE FROM settings WHERE key IN ('withdraw_diamonds_per_usd', 'coin_price_idr');

CREATE TABLE IF NOT EXISTS coin_packages (
  id              SERIAL PRIMARY KEY,
  coins           BIGINT      NOT NULL UNIQUE CHECK (coins > 0),
  price_idr       BIGINT      NOT NULL CHECK (price_idr > 0),   -- harga Rupiah (Indonesia)
  price_usd_cents INTEGER     NOT NULL CHECK (price_usd_cents > 0), -- harga USD dalam sen (negara lain)
  badge           VARCHAR(20),                                  -- label opsional, mis. "Populer"
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  active          BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO coin_packages (coins, price_idr, price_usd_cents, sort_order)
SELECT * FROM (VALUES
  (18000::bigint,    36000::bigint,   212, 1),
  (36000::bigint,    72000::bigint,   424, 2),
  (54000::bigint,   108000::bigint,   635, 3),
  (90000::bigint,   180000::bigint,  1059, 4),
  (180000::bigint,  360000::bigint,  2118, 5),
  (450000::bigint,  900000::bigint,  5294, 6),
  (900000::bigint, 1800000::bigint, 10588, 7),
  (1800000::bigint, 3600000::bigint, 21176, 8)
) AS v(coins, price_idr, price_usd_cents, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM coin_packages);

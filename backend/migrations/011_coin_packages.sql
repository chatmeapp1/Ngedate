-- Paket koin untuk layar Top up (harga ditentukan admin).
-- Harga awal memakai 6.667 koin = 1 USD dan Rp 17.000/USD, yaitu Rp 2,55 per koin dan US$ 0,00015 per koin.

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
  (18000::bigint,    45900::bigint,   270, 1),
  (36000::bigint,    91800::bigint,   540, 2),
  (54000::bigint,   137700::bigint,   810, 3),
  (90000::bigint,   229500::bigint,  1350, 4),
  (180000::bigint,  459000::bigint,  2700, 5),
  (450000::bigint, 1147500::bigint,  6750, 6),
  (900000::bigint, 2295000::bigint, 13500, 7),
  (1800000::bigint, 4590000::bigint, 27000, 8)
) AS v(coins, price_idr, price_usd_cents, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM coin_packages);

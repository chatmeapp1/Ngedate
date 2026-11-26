-- Gift dengan pengali bagian host (mis. x2): host menerima bagian gift x pengali.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS host_multiplier INTEGER NOT NULL DEFAULT 1
  CHECK (host_multiplier BETWEEN 1 AND 5);

-- Nilai awal baru: 6.667 diamond = 1 USD (1 diamond = Rp 2,55); bagian host dari gift 10%
DELETE FROM settings WHERE key IN ('withdraw_diamonds_per_usd', 'gift_host_share');

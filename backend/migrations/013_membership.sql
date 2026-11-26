-- Level & VIP dari total top up koin; kartu pesan gratis untuk VIP.
ALTER TABLE users ADD COLUMN IF NOT EXISTS topup_total BIGINT NOT NULL DEFAULT 0;
UPDATE users u SET topup_total = COALESCE((
  SELECT SUM(l.amount) FROM ledger l WHERE l.user_id = u.id AND l.currency = 'coin' AND l.reason = 'admin_topup' AND l.amount > 0
), 0);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS free_card BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS messages_free_card_idx ON messages (sender_id, created_at) WHERE free_card;

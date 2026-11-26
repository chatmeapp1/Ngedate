-- Level host (0-10) dari total PENDAPATAN diamond seumur hidup (chat, gift, kartu gratis).
ALTER TABLE users ADD COLUMN IF NOT EXISTS income_total BIGINT NOT NULL DEFAULT 0;
UPDATE users u SET income_total = COALESCE((
  SELECT SUM(l.amount) FROM ledger l
  WHERE l.user_id = u.id AND l.currency = 'diamond' AND l.amount > 0
    AND l.reason IN ('chat_income', 'gift_income', 'free_card_income')
), 0);

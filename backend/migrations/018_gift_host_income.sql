-- Penghasilan host (diamond) dari tiap gift, supaya host melihat nilai yang ia terima, bukan harga gift.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS host_income BIGINT;
UPDATE messages m SET host_income = l.amount
FROM ledger l
WHERE m.type = 'gift' AND l.reason = 'gift_income' AND l.currency = 'diamond'
  AND l.ref_type = 'message' AND l.ref_id = m.id;

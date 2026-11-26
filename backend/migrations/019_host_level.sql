-- Level host (0-10) dari total penghasilan diamond 7 hari terakhir (bergulir; bisa naik dan turun).
-- Indeks mempercepat penjumlahan penghasilan per host.
CREATE INDEX IF NOT EXISTS ledger_income_idx ON ledger (user_id, created_at)
  WHERE currency = 'diamond' AND amount > 0 AND reason IN ('chat_income', 'gift_income', 'free_card_income');

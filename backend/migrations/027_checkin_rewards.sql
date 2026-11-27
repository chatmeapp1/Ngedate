-- Hadiah check-in: pesan gratis (kredit), bingkai avatar sementara
ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_cards INTEGER NOT NULL DEFAULT 0 CHECK (checkin_cards >= 0);
ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_frame SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_frame_until TIMESTAMPTZ;
-- Sumber pesan gratis: 'vip' (kartu harian VIP) atau 'checkin' (kredit dari check-in). Null = lama (VIP).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS free_card_source TEXT;
ALTER TABLE user_checkins ADD COLUMN IF NOT EXISTS reward TEXT;
ALTER TABLE user_checkins ALTER COLUMN coins DROP NOT NULL;

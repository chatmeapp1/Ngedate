-- Bingkai avatar yang dipakai bila punya dua (bingkai VIP dan hadiah check-in): hanya satu yang terpasang
ALTER TABLE users ADD COLUMN IF NOT EXISTS frame_choice VARCHAR(8) CHECK (frame_choice IN ('vip', 'checkin'));

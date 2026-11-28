-- Foto/video privat host harus disetujui admin sebelum pengguna bisa melihat atau membukanya.
-- Pesan lama dianggap sudah disetujui.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS messages_media_review_idx ON messages (review_status, id DESC) WHERE media_private;

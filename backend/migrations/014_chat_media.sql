-- Foto & video di chat (fitur VIP)
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'gift', 'system', 'image', 'video'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url VARCHAR(500);
CREATE INDEX IF NOT EXISTS messages_media_idx ON messages (sender_id, created_at) WHERE type IN ('image', 'video');

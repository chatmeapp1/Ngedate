-- Permintaan gift dari host ke pengguna: host tidak membayar apa pun, pengguna memilih mengirim atau tidak
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'gift', 'system', 'image', 'video', 'giftreq'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gift_request_status VARCHAR(10) CHECK (gift_request_status IN ('pending', 'done'));

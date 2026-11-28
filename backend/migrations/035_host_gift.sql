-- Gift dari host ke pengguna: tipe pesan tersendiri agar tidak ikut hitungan gift/peringkat/gaji
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'gift', 'system', 'image', 'video', 'hostgift'));

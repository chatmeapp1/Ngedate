-- Foto momen harus disetujui admin dulu; teks saja langsung tampil
ALTER TABLE moments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE moments ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE moments DROP CONSTRAINT IF EXISTS moments_check;
CREATE INDEX IF NOT EXISTS moments_status_idx ON moments (status, id DESC);

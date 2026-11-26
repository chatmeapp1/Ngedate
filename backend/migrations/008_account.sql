-- Pengaturan akun: status "deleted" (akun dihapus & dianonimkan) dan penanda password

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'deleted'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Akun Login cepat dibuat dengan password acak yang tidak diketahui pemiliknya.
-- false = pemilik belum pernah mengatur password sendiri.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT true;
UPDATE users SET password_set = false WHERE id IN (SELECT user_id FROM device_accounts);

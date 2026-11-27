-- Penghasilan baru dihitung sejak host didaftarkan ke gaji pokok (bukan dari awal minggu).
-- Baris yang sudah ada mulai dihitung dari saat migrasi ini dijalankan.
ALTER TABLE host_salary ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now();

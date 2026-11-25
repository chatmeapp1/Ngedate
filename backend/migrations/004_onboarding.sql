-- =====================================================================
-- Onboarding, agency, verifikasi wajah, dan cek foto host
-- =====================================================================

-- Agency: dibuat admin, punya satu kode undangan tetap.
-- commission_rate = bagian agency dari TOTAL koin, diambil dari bagian host.
-- Contoh: host_share 0.5 dan commission_rate 0.1 -> host 40%, agency 10%, platform 50%.
CREATE TABLE IF NOT EXISTS agencies (
  id               BIGSERIAL PRIMARY KEY,
  name             VARCHAR(80)   NOT NULL,
  code             VARCHAR(16)   NOT NULL UNIQUE,
  commission_rate  NUMERIC(5, 4) NOT NULL DEFAULT 0.1 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  active           BOOLEAN       NOT NULL DEFAULT true,
  earnings_total   BIGINT        NOT NULL DEFAULT 0,
  contact          VARCHAR(120),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agency_earnings (
  id          BIGSERIAL PRIMARY KEY,
  agency_id   BIGINT      NOT NULL REFERENCES agencies (id),
  host_id     BIGINT      NOT NULL REFERENCES users (id),
  amount      BIGINT      NOT NULL CHECK (amount > 0),
  source      VARCHAR(20) NOT NULL,   -- chat, gift
  ref_type    VARCHAR(20),
  ref_id      BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_earnings_agency_idx ON agency_earnings (agency_id, id DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified           BOOLEAN NOT NULL DEFAULT false;  -- centang biru
-- Status host: pending (menunggu verifikasi) | approved (tampil di daftar) | rejected
ALTER TABLE users ADD COLUMN IF NOT EXISTS host_status        VARCHAR(10) CHECK (host_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_id          BIGINT REFERENCES agencies (id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_avatar_url TEXT;   -- foto profil host menunggu dicek admin
ALTER TABLE users ADD COLUMN IF NOT EXISTS language           VARCHAR(10) NOT NULL DEFAULT 'id';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tags               TEXT[] NOT NULL DEFAULT '{}';

-- Akun yang sudah ada sebelum fitur ini: dianggap sudah lengkap & host lama langsung disetujui
UPDATE users SET profile_completed = true WHERE role = 'admin' OR gender IS NOT NULL OR role = 'host';
UPDATE users SET host_status = 'approved' WHERE role = 'host' AND host_status IS NULL;

-- Status cek foto album: host -> pending dulu; user biasa -> langsung approved
ALTER TABLE user_photos ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE user_photos ADD COLUMN IF NOT EXISTS reject_reason VARCHAR(200);

-- Tantangan verifikasi wajah: 3 gerakan acak, sekali pakai, berlaku singkat
CREATE TABLE IF NOT EXISTS verification_challenges (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  steps       TEXT[]      NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verifications (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  challenge_id   BIGINT      NOT NULL REFERENCES verification_challenges (id),
  steps          TEXT[]      NOT NULL,
  photo_urls     TEXT[]      NOT NULL,
  duration_ms    INTEGER,                 -- lama pengambilan foto (dari tantangan dibuat sampai dikirim)
  status         VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason  VARCHAR(200),
  reviewed_by    BIGINT      REFERENCES users (id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verifications_status_idx ON verifications (status, id);
CREATE INDEX IF NOT EXISTS verifications_user_idx ON verifications (user_id, id DESC);

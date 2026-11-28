-- Laporan untuk momen dan komentar momen
ALTER TABLE reports ADD COLUMN IF NOT EXISTS moment_id BIGINT REFERENCES moments (id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS comment_id BIGINT REFERENCES moment_comments (id) ON DELETE SET NULL;
-- Salinan isi saat dilaporkan (tetap terlihat admin walau konten dihapus)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS snapshot JSONB;
CREATE INDEX IF NOT EXISTS reports_moment_idx ON reports (moment_id) WHERE moment_id IS NOT NULL;

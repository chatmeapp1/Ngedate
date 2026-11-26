-- Efek MP4 untuk gift: animation_url sudah ada; ini menandai video berlatar hitam
-- yang diputar dengan mode "screen" agar latar hitamnya tampak transparan.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS animation_blend BOOLEAN NOT NULL DEFAULT false;

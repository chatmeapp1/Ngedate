-- Cache terjemahan (teks yang sama diterjemahkan sekali per bahasa tujuan)
CREATE TABLE IF NOT EXISTS translation_cache (
  hash        TEXT        NOT NULL,
  lang        TEXT        NOT NULL,
  result      TEXT        NOT NULL,
  source_lang TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hash, lang)
);

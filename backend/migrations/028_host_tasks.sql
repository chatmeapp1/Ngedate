-- Tugas host: klaim hadiah diamond. period = 'once' (tugas pemula) atau tanggal WIB (tugas harian).
CREATE TABLE IF NOT EXISTS host_task_claims (
  host_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task       TEXT        NOT NULL,
  period     TEXT        NOT NULL,
  reward     INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id, task, period)
);

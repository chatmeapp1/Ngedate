-- Imbalan tugas pengguna: hadiah koin untuk tugas pemula (sekali) dan harian (reset 00:00 WIB)
CREATE TABLE IF NOT EXISTS user_task_claims (
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task       TEXT        NOT NULL,
  period     TEXT        NOT NULL,
  reward     INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task, period)
);

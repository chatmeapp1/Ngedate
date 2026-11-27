-- Gaji pokok host: program per host (diatur admin), waktu online harian, pembayaran per minggu
CREATE TABLE IF NOT EXISTS host_salary (
  host_id        BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  active         BOOLEAN     NOT NULL DEFAULT true,
  minutes_per_day INTEGER    NOT NULL DEFAULT 120 CHECK (minutes_per_day BETWEEN 1 AND 1440),
  days_required  INTEGER     NOT NULL DEFAULT 5 CHECK (days_required BETWEEN 1 AND 7),
  income_target  INTEGER     NOT NULL DEFAULT 70000 CHECK (income_target >= 0),
  reward         INTEGER     NOT NULL DEFAULT 70000 CHECK (reward >= 0),
  created_by     BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detik online di app per hari (WIB); hanya dicatat untuk host yang ikut program
CREATE TABLE IF NOT EXISTS host_online_daily (
  host_id BIGINT  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     DATE    NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (host_id, day)
);

-- Satu pembayaran per host per minggu (week_start = hari Senin WIB)
CREATE TABLE IF NOT EXISTS host_salary_payouts (
  host_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start DATE        NOT NULL,
  reward     INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id, week_start)
);

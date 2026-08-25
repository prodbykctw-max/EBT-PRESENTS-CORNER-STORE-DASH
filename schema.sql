-- D1 schema for the `ebt-leaderboard` database.
-- Apply locally:  npm run db:local
-- Apply remotely: npm run db:remote

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  items      INTEGER NOT NULL DEFAULT 0,
  time_left  INTEGER NOT NULL DEFAULT 0,
  won        INTEGER NOT NULL DEFAULT 0,
  country    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The leaderboard read is always "top N by score, oldest first on ties".
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_scores_created ON scores (created_at DESC);

-- Migration number: 0002 	 2026-09-22T07:02:15.000Z

-- secret_hash gates writes: a row's secret_hash is set on first write and must match on every
-- later write to any column, so only the original account can update its own preferences.
-- New preference columns get their own migration + DEFAULT '[]', same as the two below.
CREATE TABLE user_preferences (
  user_hash TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  favorited_characters TEXT NOT NULL DEFAULT '[]', -- JSON array of character ids
  favorited_planets TEXT NOT NULL DEFAULT '[]' -- JSON array of planet ids
);

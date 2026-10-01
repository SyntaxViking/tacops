-- Migration number: 0005 	 2026-10-01T00:00:00.000Z

-- Append-only per-planet points-remaining history, written by the poller (worker/poller.ts) on its
-- existing once-every-5-minutes crusade-refresh cadence - no new upstream API calls, this just
-- stops discarding data the poller already fetches. One row per planet per tick. Rows for a given
-- planet are deleted (see planet_history_state below) the moment it's detected transitioning from
-- sunk (captured/in cooldown) back to trackable - each capture cycle gets its own clean history.
CREATE TABLE planet_history (
  planet_id TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  imperial_remaining INTEGER NOT NULL,
  devastation_remaining INTEGER NOT NULL,
  PRIMARY KEY (planet_id, at_ms)
);
CREATE INDEX idx_planet_history_planet_id ON planet_history(planet_id);

-- One row per planet, tracking only whether its *last recorded* history sample was sunk - cheap to
-- read in full (one SELECT, ~146 rows) every tick, used purely to detect the sunk -> trackable
-- transition above without needing a second query per planet to find its own last row.
CREATE TABLE planet_history_state (
  planet_id TEXT PRIMARY KEY,
  last_sunk INTEGER NOT NULL
);

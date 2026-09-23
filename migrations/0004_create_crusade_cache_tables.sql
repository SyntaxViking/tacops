-- Migration number: 0004 	 2026-09-23T00:00:00.000Z

-- Populated by the scheduled poller (worker/poller.ts), never by a user request. Singleton row
-- (id always 1) holding the latest GET_CRUSADE response - raw_response is the whole
-- eventResponseData blob, unprocessed, to avoid re-deriving a bespoke per-field schema on every
-- poll tick. crusade_id/season_number/phase/active_zone are duplicated out as columns because the
-- poller needs to read them on every tick (to compute the relevant planet set and build
-- leaderboard ids) without paying to parse raw_response when it isn't the tick that refreshed it.
CREATE TABLE crusade_snapshot_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  crusade_id TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  phase TEXT,
  active_zone INTEGER,
  raw_response TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- One row per planet the poller has ever refreshed. raw_leaderboards is the whole `leaderboards`
-- object GET_LEADERBOARD_2 returned for that planet's factionFor/factionAgainst ids, unprocessed -
-- never the account-specific playerFor/playerAgainst/myFaction ids, which are meaningless in a
-- shared cache.
CREATE TABLE planet_leaderboard_cache (
  planet_id TEXT PRIMARY KEY,
  raw_leaderboards TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- Singleton row (id always 1): the poller's own cross-invocation state. Workers keep no in-memory
-- state between invocations, so this is the only way a 1-minute cron reuses a Loki session instead
-- of re-bootstrapping every tick, and remembers where its rolling cursor left off. Read/written
-- without any locking - an overlapping tick racing another is tolerated (worst case a re-fetched
-- planet or a skipped cursor step), not worth the complexity to prevent.
CREATE TABLE poller_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  session_id TEXT,
  session_issued_at INTEGER,
  last_crusade_refresh_at INTEGER,
  cursor_index INTEGER NOT NULL DEFAULT 0
);

-- Migration number: 0010 	 2026-10-22T00:00:00.000Z

-- Reintroduces server-side per-planet leaderboard polling, replacing poller_epoch_state/
-- poller_planet_queue's whole "fetch GET_CRUSADE on a fixed 5-minute gate, write history, never
-- touch leaderboards" design (see AGENTS.md) with a single checkpointed lock+cursor loop that
-- also polls leaderboard data, bounded tightly enough to stay far under D1's write-row quota (see
-- worker/poller.ts's own top-of-file comment for the exact algorithm and write-budget math).
-- poller_lock (migrations/0008) is reused as-is - its CAS semantics are exactly what this new,
-- single poller still needs, with no second poller left to conflict with.

-- Singleton cursor row: which planet to poll next, as a full ordered planet-id list (JSON) plus
-- an index into it - not poller_planet_queue's one-row-per-planet design (AGENTS.md forbids ever
-- reviving that table/the old "planets" phase specifically; this is a new, differently-shaped
-- mechanism, not a revival). planet_ids is NULL whenever there's nothing queued - the very next
-- step then calls GET_CRUSADE to rebuild the list before polling anything. session_id/
-- session_issued_at carry over the same cached-session-reuse optimization poller_epoch_state had.
CREATE TABLE poller_leaderboard_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  planet_ids TEXT,
  cursor_index INTEGER NOT NULL DEFAULT 0,
  phase TEXT,
  crusade_id TEXT,
  season_number INTEGER,
  session_id TEXT,
  session_issued_at INTEGER
);
INSERT INTO poller_leaderboard_cursor (id) VALUES (1);

-- One row per planet, holding only account-agnostic leaderboard data (never myRank/myPoints/
-- nearMe - there's no account to be "mine" for a cache shared across every visitor, including the
-- logged-out home page) - see worker/leaderboard-cache.ts. Not a revival of migration 0004's
-- planet_leaderboard_cache (already permanently abandoned per AGENTS.md, scoped narrower than
-- what's needed now) - a cleanly-named new table instead, same precedent as
-- planet_history_cache -> planet_history_buckets. season (src/season.ts) lets a season switch
-- auto-invalidate stale cross-season entries with zero code change, same as planet_history_buckets.
CREATE TABLE shared_leaderboard_cache (
  planet_id TEXT PRIMARY KEY,
  season TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- poller_epoch_state and poller_planet_queue (migrations/0008) are left in place, unused, from
-- this point on - same precedent as planet_history_cache/planet_leaderboard_cache. This repo's
-- migrations never DROP a table (only once ever DROP INDEX, migrations/0006, for a real cost
-- reason) - abandoning in place is the established pattern.

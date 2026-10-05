-- Migration number: 0007 	 2026-10-05T00:00:00.000Z

-- Replaces planet_history/planet_history_state (migrations/0005) as the Domination tracker's
-- history store: ONE row per planet holding its whole current era's samples as a JSON array,
-- instead of one row per planet per tick. A bulk read (every planet at once, for the Monitor tab)
-- is now a fixed ~100-row read regardless of how much history has accumulated, instead of a full
-- table scan - that scan alone burned through ~83% of the account's entire 5-million-rows-read/day
-- D1 budget in under 6 hours on 2026-10-05, from perfectly normal use (see worker/planet-history.ts's
-- top-of-file comment for the full writeup). A single-planet read and the once-every-5-minutes
-- poller write both become a single-row operation too, roughly halving the write-side cost the
-- 2026-10-03 investigation (migration 0006) addressed.
CREATE TABLE planet_history_cache (
  planet_id TEXT PRIMARY KEY,
  -- JSON-encoded array of {atMs, imperialRemaining, devastationRemaining}, oldest first, current
  -- era only (cleared and restarted on every sunk -> trackable transition, same as before).
  samples TEXT NOT NULL,
  last_sunk INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One-time backfill from the old tables so currently-accumulated history isn't lost in the switch.
-- A one-time read of the old table's full contents is an acceptable one-off cost against the daily
-- read budget this migration exists to stop bleeding continuously.
INSERT INTO planet_history_cache (planet_id, samples, last_sunk, updated_at)
SELECT
  h.planet_id,
  (
    SELECT json_group_array(json_object('atMs', at_ms, 'imperialRemaining', imperial_remaining, 'devastationRemaining', devastation_remaining))
    FROM (SELECT at_ms, imperial_remaining, devastation_remaining FROM planet_history WHERE planet_id = h.planet_id ORDER BY at_ms ASC)
  ),
  COALESCE((SELECT last_sunk FROM planet_history_state s WHERE s.planet_id = h.planet_id), 0),
  (SELECT MAX(at_ms) FROM planet_history WHERE planet_id = h.planet_id)
FROM (SELECT DISTINCT planet_id FROM planet_history) h;

-- planet_history/planet_history_state are left in place, unused by the app from this point on, as
-- a safety net - a follow-up migration can drop them once planet_history_cache has run in
-- production for a while.

-- Migration number: 0008 	 2026-10-12T00:00:00.000Z

-- Replaces poller_state's "fixed small batch of planets per tick, hope CPU doesn't run out" design
-- with a checkpointed state machine: one atomic step per tick-loop iteration (GET_CRUSADE + compute
-- the relevant planet list, or one planet's leaderboard fetch + history write), with the step's own
-- result and the state machine's "what's next" committed together in the same D1 batch. A step
-- that's interrupted mid-work - by hitting the CPU limit, which showed up as 408 of 430 scheduled
-- ticks failing with status: exceededResources for ~7 hours on 2026-10-12 - never leaves partial,
-- inconsistent state; only a fully-committed step's progress is ever visible to the next tick. See
-- worker/poller.ts's own top-of-file comment for the step loop itself.

-- Prevents two overlapping invocations (Cloudflare's Cron Triggers don't guarantee non-overlap - a
-- tick still running when the next minute's trigger fires is a real, observed possibility,
-- especially exactly when Loki is slow) from racing on the same step. A 30-second expiry -
-- comfortably above a single step's realistic worst case (one Loki call, capped at 20s by
-- loki-client.ts's own AbortSignal.timeout, plus a fast D1 write) but short enough that a
-- genuinely-dead holder (the tick that acquired it got killed before releasing) doesn't block
-- progress for more than a tick or two.
CREATE TABLE poller_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked_at INTEGER,
  holder_id TEXT
);
INSERT INTO poller_lock (id, locked_at, holder_id) VALUES (1, NULL, NULL);

-- phase: 'awaiting_epoch' (idle, waiting for the 5-minute gate to open again), 'crusade_fetch'
-- (next step does GET_CRUSADE + computes the relevant planet list into poller_planet_queue below),
-- or 'planets' (next step processes poller_planet_queue at `cursor`). session_id/session_issued_at
-- carry over the same cached-session-reuse optimization poller_state had.
CREATE TABLE poller_epoch_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase TEXT NOT NULL DEFAULT 'awaiting_epoch',
  epoch_started_at INTEGER,
  cursor INTEGER NOT NULL DEFAULT 0,
  crusade_id TEXT,
  season_number INTEGER,
  session_id TEXT,
  session_issued_at INTEGER
);
INSERT INTO poller_epoch_state (id) VALUES (1);

-- One row per relevant planet for the current epoch, written once (replacing the whole table) at
-- the crusade_fetch step, then read one row at a time by cursor position during the planets phase -
-- an indexed point-lookup, not a re-parse of the whole epoch's planet list on every single step.
-- struggle_data is JSON-encoded CrusadePlanet['struggleData'] (NULL for a planet with none).
CREATE TABLE poller_planet_queue (
  cursor_position INTEGER PRIMARY KEY,
  planet_id TEXT NOT NULL,
  side_owner TEXT,
  owned_by_faction TEXT,
  points_for INTEGER,
  points_against INTEGER,
  struggle_data TEXT
);

-- poller_state is superseded by poller_epoch_state + poller_planet_queue above - left in place as
-- a safety net, same precedent as migration 0007 left planet_history/planet_history_state in place.

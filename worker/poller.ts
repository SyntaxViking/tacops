// Scheduled background poller (see worker/index.ts's `scheduled` export, wired to a 1-minute Cron
// Trigger in wrangler.toml). Refreshes the public, account-agnostic crusade cache so anonymous
// visitors (and logged-in users' first paint) never have to wait on a live Tacticus call, records
// each Domination planet's points-remaining history (worker/planet-history.ts), and polls
// per-planet leaderboard data (worker/leaderboard-cache.ts) into a shared cache that also drives
// the logged-out home page's side/faction leaderboards.
//
// Checkpointed, one planet (or one GET_CRUSADE refresh) at a time: the step's own result and the
// cursor's "what's next" commit together in one atomic db.batch(), so a step killed mid-work
// never leaves partial state - the next tick just redoes that one step.
//
// poller_leaderboard_cursor (migrations/0010) holds the full ordered list of planets still to
// poll this sweep, plus an index into it - NULL whenever nothing's queued, which is what tells
// the next step to call GET_CRUSADE and rebuild the list rather than being on any fixed schedule
// (unlike the old 5-minute-gated design this replaces - see AGENTS.md). Eligibility for that list
// differs by phase: CRUSADE polls the active zone's planets, one per invocation, always exiting
// after that one step (a full CRUSADE sweep just means letting enough 1-minute ticks pass).
// STRUGGLE polls only genuine frontier planets - not in their post-capture cooldown, and adjacent
// to an opposite-side-owned planet (worker/struggle-eligibility.ts) - looping within one
// invocation to poll up to MAX_STRUGGLE_PLANETS_PER_TICK planets, since Cloudflare's Cron
// Triggers only fire once a minute and a 146-planet map would otherwise take hours per planet.
//
// poller_lock (migrations/0008) guards against two overlapping invocations racing on the same
// step - Cloudflare's Cron Triggers don't guarantee non-overlap, and a tick running long (e.g.
// Loki being slow) is a real way to hit that. See tryAcquireLock's own comment for the exact
// mechanics.
//
// Write-budget sanity check (this design exists specifically to keep this number small - see
// AGENTS.md for the history of what happens when it isn't): CRUSADE walks one ~20-24 planet zone
// at 1/minute (~1,440 leaderboard writes/day plus 1 crusade-snapshot + bucket writes per sweep);
// STRUGGLE walks up to MAX_STRUGGLE_PLANETS_PER_TICK/minute of the frontier-eligible subset of
// ~143 planets (worst case ~5,760 leaderboard writes/day) plus 2 singleton-row writes/minute for
// lock+cursor (~2,880/day). Both stay far under D1's 100k-rows-written/day free-tier cap even
// under worst-case continuous work.
import { getPlanetData, getSectorMapData } from "../src/assets/seasons";
import { bootstrapSession, environmentConfig, fetchCrusadeDataWithSession, type Session } from "./loki-client";
import { buildLeaderboardCacheUpsertStatement, fetchSharedPlanetLeaderboard } from "./leaderboard-cache";
import { buildBucketUpsertStatements } from "./planet-history";
import { eligibleStrugglePlanetIds } from "./struggle-eligibility";
import { isInRolloverWindow } from "../src/rollover-window";
import { findActivePhase, mapCrusadeResponseData } from "../src/crusade/crusade-data-mapping";
import type { CrusadePlanet, CrusadeSectorMap } from "../src/api/types";

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // no documented Loki session TTL - defensive reuse window
// A single step's lock can't realistically run longer than two Loki calls (each capped at 20s by
// loki-client.ts's own AbortSignal.timeout) plus a fast D1 write - 30s leaves real margin on top
// of that worst case while still being short enough that a genuinely-dead holder (killed before
// releasing) only blocks progress for a tick or two, not indefinitely.
const LOCK_TTL_MS = 30_000;
// The Workers Free plan caps outbound fetch() calls at 50 per invocation (unlike D1 queries, which
// don't count against this) - stop looping with real headroom to spare rather than finding out by
// hitting the cap mid-step.
const MAX_FETCHES_PER_TICK = 45;
// Purely defensive - every real iteration consumes fetch budget (capped well below this), so this
// should never actually bind; it's just insurance against an unforeseen loop bug burning CPU
// forever instead of a bounded number of steps.
const MAX_ITERATIONS_PER_TICK = 200;
// Hard cap on how many STRUGGLE-phase planets one invocation polls - CRUSADE always exits after a
// single step (see runPollerTick), so this is the only place unbounded looping could otherwise
// happen. A full STRUGGLE sweep taking up to roughly an hour at this rate is an accepted tradeoff
// for keeping D1 write volume bounded - see this file's top-of-file write-budget math.
const MAX_STRUGGLE_PLANETS_PER_TICK = 4;

type Phase = "CRUSADE" | "STRUGGLE" | "DOWNTIME" | null;

// CRUSADE (Expansion)'s own eligibility/history-coverage list: only the active zone's planets -
// operates on the local static planet-data.json asset, not on a Loki response. During STRUGGLE
// this is also used for history-write coverage (every planet, broader than the narrower
// leaderboard-polling eligibility list - see eligibleStrugglePlanetIds), matching the existing
// "every planet's history matters during Domination" precedent (AGENTS.md).
export function relevantPlanetIds(phase: Phase, activeZone: number | null): string[] {
  const planets = getPlanetData() as { planetId: string; zone: number }[];
  if (phase === "STRUGGLE") return planets.map((p) => p.planetId);
  if (phase === "CRUSADE" && activeZone !== null) return planets.filter((p) => p.zone === activeZone).map((p) => p.planetId);
  return [];
}

interface CursorRow {
  planet_ids: string | null;
  cursor_index: number;
  phase: Phase;
  crusade_id: string | null;
  season_number: number | null;
  session_id: string | null;
  session_issued_at: number | null;
}

// Mirrors poller_leaderboard_cursor's own column defaults (migrations/0010) - used only if the
// singleton row is somehow missing (shouldn't happen once the migration's seed INSERT has run,
// but cheaper to fall back correctly than to assume the row always exists).
const DEFAULT_CURSOR: CursorRow = {
  planet_ids: null,
  cursor_index: 0,
  phase: null,
  crusade_id: null,
  season_number: null,
  session_id: null,
  session_issued_at: null,
};

async function readCursor(db: D1Database): Promise<CursorRow> {
  const row = await db
    .prepare("SELECT planet_ids, cursor_index, phase, crusade_id, season_number, session_id, session_issued_at FROM poller_leaderboard_cursor WHERE id = 1")
    .first<CursorRow>();
  return row ?? DEFAULT_CURSOR;
}

// Acquire-or-bail: succeeds (returns a holderId) only if the lock is free or its holder's claim has
// expired (judged by LOCK_TTL_MS, not by whether that holder is actually still running - a real
// invocation that's simply slow looks the same as a dead one from here, which is the whole point:
// no heartbeat to maintain, just a conservative expiry). Fails (returns null) if some other,
// currently-valid holder has it - the caller's response to that is always "end this invocation,
// let the next minute's tick try again", never a retry loop within the same invocation.
async function tryAcquireLock(db: D1Database, nowMs: number): Promise<string | null> {
  const holderId = crypto.randomUUID();
  const result = await db
    .prepare("UPDATE poller_lock SET locked_at = ?, holder_id = ? WHERE id = 1 AND (locked_at IS NULL OR locked_at < ?)")
    .bind(nowMs, holderId, nowMs - LOCK_TTL_MS)
    .run();
  return (result.meta.changes ?? 0) > 0 ? holderId : null;
}

// Only releases if this invocation still actually holds the lock (holder_id still matches) -
// defensive guard against the rare case where this invocation's own claim already expired and got
// re-acquired by someone else before this release runs; without the check this would release a
// lock it no longer owns.
function releaseLockStatement(db: D1Database, holderId: string): D1PreparedStatement {
  return db.prepare("UPDATE poller_lock SET locked_at = NULL, holder_id = NULL WHERE id = 1 AND holder_id = ?").bind(holderId);
}

const POLLER_ENVIRONMENT = "prod"; // mirrors src/track-usage.ts's prod-only policy; QA isn't public-facing

interface ResolvedSession {
  session: Session;
  issuedAt: number;
}

// Reconstructing a cached session is a pure local lookup (environmentConfig), no network call -
// this is what lets most steps skip the 2-fetch APP_START+CONNECT bootstrap entirely.
async function resolveSession(
  state: Pick<CursorRow, "session_id" | "session_issued_at">,
  userId: string,
  clientSecret: string,
  nowMs: number,
  countFetches: (n: number) => void,
): Promise<ResolvedSession> {
  const config = environmentConfig(POLLER_ENVIRONMENT);
  if (state.session_id && state.session_issued_at !== null && nowMs - state.session_issued_at < SESSION_MAX_AGE_MS) {
    return { session: { config, baseUrl: `${config.baseUrl}/${userId}`, sessionId: state.session_id }, issuedAt: state.session_issued_at };
  }
  const session = await bootstrapSession(POLLER_ENVIRONMENT, userId, clientSecret, "");
  countFetches(2); // APP_START + CONNECT
  return { session, issuedAt: nowMs };
}

interface StepResult {
  didWork: boolean;
  // The phase that was actually worked this step - null for "nothing more to do this tick"
  // (rollover window, a crusade-fetch failure, or a freshly-rebuilt cursor with zero eligible
  // planets). runPollerTick only keeps looping while this is "STRUGGLE".
  phase: Phase;
}

// Runs exactly one checkpointed step under the lock identified by holderId, committing the step's
// own work together with the cursor's advance and the lock release in one atomic db.batch().
async function runOneStep(
  db: D1Database,
  userId: string,
  clientSecret: string,
  holderId: string,
  nowMs: number,
  countFetches: (n: number) => void,
): Promise<StepResult> {
  const release = releaseLockStatement(db, holderId);

  // The game's own daily server reset/rollover (23:30-00:30 UTC) - do no work and release the
  // lock. nowMs is re-read fresh at the top of every loop iteration in runPollerTick, so an
  // invocation that's already mid-run when the window begins hits this on its very next step.
  if (isInRolloverWindow(nowMs)) {
    await db.batch([release]);
    return { didWork: false, phase: null };
  }

  const cursor = await readCursor(db);

  if (!cursor.planet_ids) {
    return runRebuildStep(db, userId, clientSecret, cursor, release, nowMs, countFetches);
  }
  return runPolledPlanetStep(db, userId, clientSecret, cursor, release, nowMs, countFetches);
}

// The cursor is empty - call GET_CRUSADE, write history for every relevant planet (unchanged,
// broader coverage than the leaderboard-eligibility list below), compute this phase's
// leaderboard-eligible planet list, and immediately fetch the first eligible planet's leaderboard
// too, so this step still produces one planet of real leaderboard work rather than a wasted tick.
async function runRebuildStep(
  db: D1Database,
  userId: string,
  clientSecret: string,
  cursor: CursorRow,
  release: D1PreparedStatement,
  nowMs: number,
  countFetches: (n: number) => void,
): Promise<StepResult> {
  const { session, issuedAt } = await resolveSession(cursor, userId, clientSecret, nowMs, countFetches);

  let text: string;
  let data: any;
  try {
    const result = await fetchCrusadeDataWithSession(session, userId);
    countFetches(1);
    text = result.text;
    data = result.parsed?.eventResults?.[0]?.eventResponseData;
  } catch (error) {
    console.error("[poller] crusade fetch failed, will retry next tick", error);
    await db.batch([db.prepare("UPDATE poller_leaderboard_cursor SET session_id = NULL WHERE id = 1"), release]);
    return { didWork: true, phase: null };
  }

  // One shared mapper (src/crusade/crusade-data-mapping.ts) for the whole raw response - phase/
  // activeZone (findActivePhase) and every planet (with real name/zone lookups, not placeholders)
  // in one pass, same as the client's own live fetch and crusade-cache-seed.ts's cached-replay
  // path use.
  const mapped = mapCrusadeResponseData(data);
  const active = { phase: mapped.phase, activeZone: mapped.activeZone };
  const crusadeId = mapped.crusadeId;
  const seasonNumber = mapped.seasonNumber;
  const planetsById = new Map(mapped.planets.map((p) => [p.planetId, p]));

  const historyPlanetIds = relevantPlanetIds(active.phase, active.activeZone);
  const historyPlanets = historyPlanetIds.map((planetId) => planetsById.get(planetId)).filter((p): p is CrusadePlanet => p !== undefined);
  const historyStatements = await buildBucketUpsertStatements(db, historyPlanets, nowMs);

  let eligiblePlanetIds: string[] = [];
  if (active.phase === "CRUSADE") {
    eligiblePlanetIds = historyPlanetIds;
  } else if (active.phase === "STRUGGLE") {
    eligiblePlanetIds = eligibleStrugglePlanetIds(mapped.planets, getSectorMapData() as CrusadeSectorMap, nowMs);
  }

  const snapshotStatement = db
    .prepare(
      "INSERT INTO crusade_snapshot_cache (id, crusade_id, season_number, phase, active_zone, raw_response, fetched_at) VALUES (1, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET crusade_id = excluded.crusade_id, season_number = excluded.season_number, phase = excluded.phase, " +
        "active_zone = excluded.active_zone, raw_response = excluded.raw_response, fetched_at = excluded.fetched_at",
    )
    .bind(crusadeId, seasonNumber, active.phase, active.activeZone, text, nowMs);

  if (eligiblePlanetIds.length === 0) {
    await db.batch([
      snapshotStatement,
      ...historyStatements,
      db
        .prepare(
          "UPDATE poller_leaderboard_cursor SET planet_ids = NULL, cursor_index = 0, phase = ?, crusade_id = ?, season_number = ?, session_id = ?, session_issued_at = ? WHERE id = 1",
        )
        .bind(active.phase, crusadeId, seasonNumber, session.sessionId, issuedAt),
      release,
    ]);
    return { didWork: true, phase: null };
  }

  let leaderboardStatement: D1PreparedStatement | null = null;
  let firstFetchFailed = false;
  try {
    const leaderboardData = await fetchSharedPlanetLeaderboard(session, userId, crusadeId, seasonNumber, eligiblePlanetIds[0]);
    countFetches(1);
    leaderboardStatement = buildLeaderboardCacheUpsertStatement(db, eligiblePlanetIds[0], leaderboardData, nowMs);
  } catch (error) {
    console.error(`[poller] leaderboard fetch failed for ${eligiblePlanetIds[0]}, will retry next tick`, error);
    firstFetchFailed = true;
  }

  // On a failed first-planet fetch, keep cursor_index at 0 (retry the same planet next tick)
  // rather than skipping past it - the eligible-planet list itself is still fresh and worth
  // keeping either way.
  const nextIndex = firstFetchFailed ? 0 : eligiblePlanetIds.length > 1 ? 1 : null;

  const statements: D1PreparedStatement[] = [snapshotStatement, ...historyStatements];
  if (leaderboardStatement) statements.push(leaderboardStatement);
  statements.push(
    db
      .prepare(
        "UPDATE poller_leaderboard_cursor SET planet_ids = ?, cursor_index = ?, phase = ?, crusade_id = ?, season_number = ?, session_id = ?, session_issued_at = ? WHERE id = 1",
      )
      .bind(
        nextIndex === null ? null : JSON.stringify(eligiblePlanetIds),
        nextIndex ?? 0,
        active.phase,
        crusadeId,
        seasonNumber,
        session.sessionId,
        issuedAt,
      ),
  );
  statements.push(release);
  await db.batch(statements);
  return { didWork: true, phase: active.phase };
}

// The cursor already has a planet queued at cursor_index - fetch just that one planet's
// leaderboard and advance (or clear, if it was the last one).
async function runPolledPlanetStep(
  db: D1Database,
  userId: string,
  clientSecret: string,
  cursor: CursorRow,
  release: D1PreparedStatement,
  nowMs: number,
  countFetches: (n: number) => void,
): Promise<StepResult> {
  const planetIds: string[] = JSON.parse(cursor.planet_ids!);
  const planetId = planetIds[cursor.cursor_index];
  const { session, issuedAt } = await resolveSession(cursor, userId, clientSecret, nowMs, countFetches);

  let leaderboardStatement: D1PreparedStatement | null = null;
  let fetchFailed = false;
  try {
    const leaderboardData = await fetchSharedPlanetLeaderboard(session, userId, cursor.crusade_id ?? "", cursor.season_number ?? 0, planetId);
    countFetches(1);
    leaderboardStatement = buildLeaderboardCacheUpsertStatement(db, planetId, leaderboardData, nowMs);
  } catch (error) {
    console.error(`[poller] leaderboard fetch failed for ${planetId}, will retry next tick`, error);
    fetchFailed = true;
  }

  const isLast = cursor.cursor_index + 1 >= planetIds.length;
  // A failed fetch keeps the cursor exactly where it was (retry the same planet next tick)
  // instead of advancing past it.
  const nextPlanetIds = fetchFailed ? cursor.planet_ids : isLast ? null : cursor.planet_ids;
  const nextIndex = fetchFailed ? cursor.cursor_index : isLast ? 0 : cursor.cursor_index + 1;

  const statements: D1PreparedStatement[] = [];
  if (leaderboardStatement) statements.push(leaderboardStatement);
  statements.push(
    db
      .prepare("UPDATE poller_leaderboard_cursor SET planet_ids = ?, cursor_index = ?, session_id = ?, session_issued_at = ? WHERE id = 1")
      .bind(nextPlanetIds, nextIndex, session.sessionId, issuedAt),
  );
  statements.push(release);
  await db.batch(statements);
  return { didWork: true, phase: cursor.phase };
}

export async function runPollerTick(db: D1Database, userId: string, clientSecret: string): Promise<void> {
  // The game's own daily server reset/rollover (23:30-00:30 UTC) - if a tick wakes up entirely
  // within the window, don't even attempt to acquire the lock (runOneStep's own check above
  // already handles an invocation that's already mid-run when the window begins; this is the
  // "just start up and shut right down" case for a fresh wake-up).
  if (isInRolloverWindow(Date.now())) return;

  let fetchesUsed = 0;
  const countFetches = (n: number) => {
    fetchesUsed += n;
  };
  let struggleStepsThisTick = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS_PER_TICK; iteration++) {
    if (fetchesUsed >= MAX_FETCHES_PER_TICK) return;

    const now = Date.now();
    const holderId = await tryAcquireLock(db, now);
    if (!holderId) return; // another invocation is mid-step; wait for next tick, no retry loop here

    try {
      const { didWork, phase } = await runOneStep(db, userId, clientSecret, holderId, now, countFetches);
      if (!didWork) return; // rollover window - lock already released inside runOneStep
      if (phase !== "STRUGGLE") return; // CRUSADE always exits after one step; so does "nothing eligible"
      struggleStepsThisTick++;
      if (struggleStepsThisTick >= MAX_STRUGGLE_PLANETS_PER_TICK) return;
    } catch (error) {
      console.error("[poller] step failed", error);
      // A step that threw before committing its own batch never released the lock itself - do it
      // here so a genuine error (as opposed to a hard CPU-limit kill, which never reaches this
      // catch at all) doesn't block progress until the lock's own TTL expires.
      await db
        .prepare("UPDATE poller_lock SET locked_at = NULL, holder_id = NULL WHERE id = 1 AND holder_id = ?")
        .bind(holderId)
        .run()
        .catch(() => {});
      return;
    }
  }
}

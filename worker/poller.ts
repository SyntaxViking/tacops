// Scheduled background poller (see worker/index.ts's `scheduled` export, wired to a 1-minute Cron
// Trigger in wrangler.toml). Refreshes the public, account-agnostic crusade cache so anonymous
// visitors (and logged-in users' first paint) never have to wait on a live Tacticus call, and
// records each Domination planet's points-remaining history (worker/planet-history.ts) on the same
// cadence. Leaderboard data is deliberately NOT fetched here - it's fetched client-side, only for
// starred/live-tracked/manually-refreshed planets, to keep this cron's D1 write volume low (see
// AGENTS.md).
//
// Checkpointed: the step's own result and the state machine's "what's next" commit together in one
// atomic db.batch(), so a step killed mid-work (e.g. by the CPU limit) never leaves partial state -
// the next tick just redoes that one step. Originally this checkpointed a *per-planet* walk too
// (one planet's leaderboard fetch + history write per step, via poller_planet_queue/cursor - see
// migrations/0008), because on 2026-10-12, 408 of 430 scheduled ticks failed with status:
// exceededResources (the CPU-limit hard-kill) for ~7 hours straight, and every tick had retried the
// same doomed full-batch work from scratch with nothing checkpointed in between. That per-planet
// queue/cursor machinery is now dead code (kept but never invoked - see the "planets" phase branch
// below) now that there's no per-planet network fetch left to checkpoint against: GET_CRUSADE plus
// every relevant planet's history write (now plain local D1 reads/writes, no network call at all)
// happen together in ONE step's batch, atomic with each other - there's nothing left that benefits
// from being spread across multiple ticks.
//
// poller_lock (migrations/0008) guards against two overlapping invocations racing on the same
// step - Cloudflare's Cron Triggers don't guarantee non-overlap, and a tick running long (exactly
// when Loki itself is slow, the same condition that caused the 2026-10-12 incident) is a real way
// to hit that. See tryAcquireLock's own comment for the exact mechanics.
import { getPlanetData } from "../src/assets/seasons";
import { bootstrapSession, environmentConfig, fetchCrusadeDataWithSession, type Session } from "./loki-client";
import { buildBucketUpsertStatements, rawPlanetToCrusadePlanet } from "./planet-history";
import { isInRolloverWindow } from "../src/rollover-window";
import type { CrusadePlanet } from "../src/api/types";

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // no documented Loki session TTL - defensive reuse window
const CRUSADE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// A single step's lock can't realistically run longer than one Loki call (capped at 20s by
// loki-client.ts's own AbortSignal.timeout) plus a fast D1 write - 30s leaves real margin on top of
// that worst case while still being short enough that a genuinely-dead holder (killed before
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

interface RawCrusadePhase {
  phase: string;
  zone?: string;
  startsOn: number;
  endsOn: number;
}

// Byte-identical copy of src/api/fetch-crusade-data.ts's findActivePhase - duplicated rather than
// imported because that module pulls in @tauri-apps/api/core and browser-only fetch helpers that
// don't belong in the Workers runtime. Keep the two in sync by hand if the phase-schedule shape
// ever changes.
export function findActivePhase(
  downtimePhase: RawCrusadePhase | undefined,
  crusadePhases: RawCrusadePhase[],
  strugglePhase: RawCrusadePhase | undefined,
): { phase: "CRUSADE" | "STRUGGLE" | "DOWNTIME" | null; activeZone: number | null } {
  const now = Date.now();
  const allPhases = [downtimePhase, ...crusadePhases, strugglePhase].filter((p): p is RawCrusadePhase => p !== undefined);
  const active = allPhases.find((p) => now >= p.startsOn && now < p.endsOn);
  if (!active) return { phase: null, activeZone: null };

  if (active.phase !== "CRUSADE" || !active.zone) {
    return { phase: active.phase as "CRUSADE" | "STRUGGLE" | "DOWNTIME", activeZone: null };
  }
  const oneBased = parseInt(active.zone.replace("zone", ""), 10);
  return { phase: "CRUSADE", activeZone: Number.isNaN(oneBased) ? null : oneBased - 1 };
}

// STRUGGLE (Domination): every planet is contestable at once. CRUSADE (Expansion): only the active
// zone's planets matter. DOWNTIME/unknown: nothing to poll. Operates on the local static
// planet-data.json asset, not on a Loki response, so it's unaffected by the no-reshaping decision.
export function relevantPlanetIds(phase: string | null, activeZone: number | null): string[] {
  const planets = getPlanetData() as { planetId: string; zone: number }[];
  if (phase === "STRUGGLE") return planets.map((p) => p.planetId);
  if (phase === "CRUSADE" && activeZone !== null) return planets.filter((p) => p.zone === activeZone).map((p) => p.planetId);
  return [];
}

// See migrations/0008's own comment for what each phase means and when runOneStep transitions
// between them.
type EpochPhase = "awaiting_epoch" | "crusade_fetch" | "planets";

interface EpochStateRow {
  phase: EpochPhase;
  epoch_started_at: number | null;
  cursor: number;
  crusade_id: string | null;
  season_number: number | null;
  session_id: string | null;
  session_issued_at: number | null;
}

// Mirrors poller_epoch_state's own column defaults (migrations/0008) - used only if the singleton
// row is somehow missing (shouldn't happen once the migration's seed INSERT has run, but cheaper
// to fall back correctly than to assume the row always exists).
const DEFAULT_EPOCH_STATE: EpochStateRow = {
  phase: "awaiting_epoch",
  epoch_started_at: null,
  cursor: 0,
  crusade_id: null,
  season_number: null,
  session_id: null,
  session_issued_at: null,
};

async function readEpochState(db: D1Database): Promise<EpochStateRow> {
  const row = await db
    .prepare("SELECT phase, epoch_started_at, cursor, crusade_id, season_number, session_id, session_issued_at FROM poller_epoch_state WHERE id = 1")
    .first<EpochStateRow>();
  return row ?? DEFAULT_EPOCH_STATE;
}

// One row per poller_planet_queue read - see that table's own comment in migrations/0008 for why
// this is a dedicated table (an indexed point-lookup by cursor_position) rather than a JSON blob
// re-parsed on every planet step.
interface PlanetQueueRow {
  cursor_position: number;
  planet_id: string;
  side_owner: string | null;
  owned_by_faction: string | null;
  points_for: number | null;
  points_against: number | null;
  struggle_data: string | null;
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
  state: Pick<EpochStateRow, "session_id" | "session_issued_at">,
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

// Runs exactly one checkpointed step (whichever the current phase calls for) under the lock
// identified by holderId, committing the step's own work together with the epoch state's advance
// and the lock release in one atomic db.batch(). Returns whether a step actually ran - false only
// for the "still waiting on the 5-minute gate" no-op, which the caller treats as "nothing to do,
// stop looping".
async function runOneStep(
  db: D1Database,
  userId: string,
  clientSecret: string,
  holderId: string,
  nowMs: number,
  countFetches: (n: number) => void,
): Promise<boolean> {
  const release = releaseLockStatement(db, holderId);

  // The game's own daily server reset/rollover (23:30-00:30 UTC) - do no work and release the
  // lock, same no-op shape as the "gate not open" case below. Checked first, before even reading
  // epoch state, so a tick that wakes up entirely within the window never does anything at all
  // (see runPollerTick's own earlier bail-out for the "don't even attempt the lock" half of this).
  // nowMs is re-read fresh at the top of every loop iteration in runPollerTick, so an invocation
  // that's already mid-run when the window begins hits this on its very next step.
  if (isInRolloverWindow(nowMs)) {
    await db.batch([release]);
    return false;
  }

  const state = await readEpochState(db);

  if (state.phase === "awaiting_epoch") {
    const gateOpen = state.epoch_started_at === null || nowMs - state.epoch_started_at >= CRUSADE_REFRESH_INTERVAL_MS;
    if (!gateOpen) {
      await db.batch([release]);
      return false;
    }
    // Pure phase transition, no fetch yet - the actual GET_CRUSADE call happens on the next
    // acquired step, so a CPU kill between here and there just means retrying this (free, idempotent)
    // transition, never losing real work.
    await db.batch([db.prepare("UPDATE poller_epoch_state SET phase = 'crusade_fetch' WHERE id = 1"), release]);
    return true;
  }

  const { session, issuedAt } = await resolveSession(state, userId, clientSecret, nowMs, countFetches);

  if (state.phase === "crusade_fetch") {
    let text: string;
    let data: any;
    try {
      const result = await fetchCrusadeDataWithSession(session, userId);
      countFetches(1);
      text = result.text;
      data = result.parsed?.eventResults?.[0]?.eventResponseData;
    } catch (error) {
      console.error("[poller] crusade fetch failed, will retry next tick", error);
      await db.batch([
        db.prepare("UPDATE poller_epoch_state SET session_id = NULL WHERE id = 1"), // force a fresh bootstrap next attempt
        release,
      ]);
      return true;
    }

    const active = findActivePhase(data?.downtimePhase, data?.crusadePhases ?? [], data?.strugglePhase);
    const crusadeId = data?.crusadeId ?? "";
    const seasonNumber = data?.seasonNumber ?? 0;
    const relevantIds = relevantPlanetIds(active.phase, active.activeZone);
    const planetsById = new Map<string, { sideOwner?: string; ownedByFaction?: string; pointsFor?: number; pointsAgainst?: number; struggleData?: unknown }>(
      ((data?.planetsData ?? []) as { planetId: string }[]).map((p: any) => [p.planetId, p]),
    );

    // History writes go straight to planet_history_buckets (grouped PLANETS_PER_BUCKET-per-row,
    // see worker/planet-history.ts's top-of-file comment and AGENTS.md) from the planetsById map
    // above - never through poller_planet_queue/the "planets" phase below (now permanently dead
    // code, kept but never reached). That queue/cursor machinery existed only to checkpoint a
    // per-planet *leaderboard fetch* (a slow, fallible network call) across many ticks; now that
    // each planet's step is purely local D1 reads/writes, rebuilding and walking a queue is pure
    // D1-operation waste with no benefit.
    const relevantPlanets: CrusadePlanet[] = relevantIds.map((planetId) => {
      const raw = planetsById.get(planetId);
      return rawPlanetToCrusadePlanet({
        planetId,
        sideOwner: raw?.sideOwner,
        ownedByFaction: raw?.ownedByFaction,
        pointsFor: raw?.pointsFor,
        pointsAgainst: raw?.pointsAgainst,
        struggleData: raw?.struggleData as CrusadePlanet["struggleData"],
      });
    });
    const historyStatements = await buildBucketUpsertStatements(db, relevantPlanets, nowMs);

    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          "INSERT INTO crusade_snapshot_cache (id, crusade_id, season_number, phase, active_zone, raw_response, fetched_at) VALUES (1, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET crusade_id = excluded.crusade_id, season_number = excluded.season_number, phase = excluded.phase, " +
            "active_zone = excluded.active_zone, raw_response = excluded.raw_response, fetched_at = excluded.fetched_at",
        )
        .bind(crusadeId, seasonNumber, active.phase, active.activeZone, text, nowMs),
      ...historyStatements,
      db
        .prepare("UPDATE poller_epoch_state SET phase = 'awaiting_epoch', epoch_started_at = ?, crusade_id = ?, season_number = ?, session_id = ?, session_issued_at = ? WHERE id = 1")
        .bind(nowMs, crusadeId, seasonNumber, session.sessionId, issuedAt),
      release,
    ];
    await db.batch(statements);
    return true;
  }

  // state.phase === "planets" - DEAD CODE, kept but never reached: the crusade_fetch step above
  // always transitions straight back to "awaiting_epoch" now, never to "planets", so
  // poller_epoch_state.phase can no longer actually hold "planets" and this branch never runs.
  // Deliberately left in place rather than deleted/merged into the step above - see
  // poller_planet_queue's own comment in migrations/0008 and AGENTS.md for why this per-planet
  // queue/cursor walk (built to checkpoint a slow per-planet *network fetch* that no longer exists)
  // must never be called again: rebuilding and walking it would just be D1-operation cost with zero
  // benefit now that every planet's step is a plain local D1 read/write.
  const queueRow = await db.prepare("SELECT * FROM poller_planet_queue WHERE cursor_position = ?").bind(state.cursor).first<PlanetQueueRow>();
  if (!queueRow) {
    await db.batch([db.prepare("UPDATE poller_epoch_state SET phase = 'awaiting_epoch' WHERE id = 1"), release]);
    return true;
  }

  const planet: CrusadePlanet = rawPlanetToCrusadePlanet({
    planetId: queueRow.planet_id,
    sideOwner: queueRow.side_owner ?? undefined,
    ownedByFaction: queueRow.owned_by_faction ?? undefined,
    pointsFor: queueRow.points_for ?? undefined,
    pointsAgainst: queueRow.points_against ?? undefined,
    struggleData: queueRow.struggle_data ? JSON.parse(queueRow.struggle_data) : undefined,
  });

  const statements: D1PreparedStatement[] = [];

  try {
    const historyStatement = await buildHistoryUpsertStatement(db, planet, nowMs);
    if (historyStatement) statements.push(historyStatement);
  } catch (error) {
    console.error(`[poller] planet ${planet.planetId} history write failed`, error);
  }

  statements.push(db.prepare("UPDATE poller_epoch_state SET cursor = ?, session_id = ?, session_issued_at = ? WHERE id = 1").bind(state.cursor + 1, session.sessionId, issuedAt));
  statements.push(release);
  await db.batch(statements);
  return true;
}

export async function runPollerTick(db: D1Database, userId: string, clientSecret: string): Promise<void> {
  // The game's own daily server reset/rollover (23:30-00:30 UTC) - if a tick wakes up entirely
  // within the window, don't even attempt to acquire the lock (runOneStep's own check below
  // already handles an invocation that's already mid-run when the window begins; this is the
  // "just start up and shut right down" case for a fresh wake-up).
  if (isInRolloverWindow(Date.now())) return;

  let fetchesUsed = 0;
  const countFetches = (n: number) => {
    fetchesUsed += n;
  };

  for (let iteration = 0; iteration < MAX_ITERATIONS_PER_TICK; iteration++) {
    if (fetchesUsed >= MAX_FETCHES_PER_TICK) return;

    const now = Date.now();
    const holderId = await tryAcquireLock(db, now);
    if (!holderId) return; // another invocation is mid-step; wait for next tick, no retry loop here

    try {
      const didWork = await runOneStep(db, userId, clientSecret, holderId, now, countFetches);
      if (!didWork) return; // awaiting_epoch, gate not open - lock already released inside runOneStep
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

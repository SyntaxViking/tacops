// Scheduled background poller (see worker/index.ts's `scheduled` export, wired to a 1-minute Cron
// Trigger in wrangler.toml). Refreshes the public, account-agnostic crusade/leaderboard cache so
// anonymous visitors (and logged-in users' first paint) never have to wait on a live Tacticus call,
// and records each Domination planet's points-remaining history (worker/planet-history.ts) on the
// same cadence.
//
// Checkpointed, one atomic step per loop iteration - not "every tick does a fixed small batch of
// planets and hopes the CPU budget holds". The old fixed-batch design still broke: on 2026-10-12,
// 408 of 430 scheduled ticks failed with status: exceededResources (the CPU-limit hard-kill, which
// never reaches a catch block, let alone a state write) for ~7 hours straight - every tick retried
// the same doomed work from scratch with nothing checkpointed in between, so 7 hours of Domination
// history silently went unrecorded. Here, each step (GET_CRUSADE + computing the relevant planet
// list, or one planet's leaderboard fetch + history write) commits its own result AND the state
// machine's "what's next" together in one atomic db.batch() - so a step that gets killed mid-work
// just means the next tick resumes exactly where the last *completed* step left off, never losing
// more than one step's worth of progress regardless of how long a bad stretch lasts. One invocation
// loops through as many steps as it can: cheap planets, many steps fit in 10s of seconds; one slow
// one, maybe just one.
//
// poller_lock (migrations/0008) guards against two overlapping invocations racing on the same
// step - Cloudflare's Cron Triggers don't guarantee non-overlap, and a tick running long (exactly
// when Loki itself is slow, the same condition that caused the 2026-10-12 incident) is a real way
// to hit that. See tryAcquireLock's own comment for the exact mechanics.
import { getPlanetData } from "../src/assets/seasons";
import { FACTION_SIDE } from "../src/factions/faction-side";
import { bootstrapSession, environmentConfig, fetchCrusadeDataWithSession, fetchLeaderboardTextWithSession, type Session } from "./loki-client";
import { buildHistoryUpsertStatement, rawPlanetToCrusadePlanet } from "./planet-history";
import type { CrusadePlanet } from "../src/api/types";

// The 22 faction ids, reused as-is (no Tauri/browser coupling in faction-side.ts, unlike
// fetch-crusade-data.ts, so no need to duplicate this list).
const ALL_FACTION_IDS = Object.keys(FACTION_SIDE);

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

// Player-level leaderboard ids for one planet: the side leaderboard (all players on a side - not
// account-specific once stripped of myRank/myPoints, so unlike fetch-crusade-data.ts's
// leaderboardIdsForPlanet this poller DOES fetch these) plus one per-faction leaderboard for every
// possible faction, since a visitor's pick isn't known at poll time - any of the 22 could be
// picked, so all 22 need to be cached. Never the crusadeFaction:... aggregate-standings ids (that
// was the "Leading Factions" list, dropped per product decision).
export function allLeaderboardIdsForPlanet(crusadeId: string, seasonNumber: number, planetId: string): string[] {
  const base = `${crusadeId}_${seasonNumber}_${planetId}`;
  const ids = [`crusadePlayer:crusade_leaderboard_planet_side_players_${base}_for`, `crusadePlayer:crusade_leaderboard_planet_side_players_${base}_against`];
  for (const factionId of ALL_FACTION_IDS) {
    ids.push(`crusadePlayer:crusade_leaderboard_planet_faction_players_${base}_${factionId}`);
  }
  return ids;
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
  const state = await readEpochState(db);
  const release = releaseLockStatement(db, holderId);

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

    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          "INSERT INTO crusade_snapshot_cache (id, crusade_id, season_number, phase, active_zone, raw_response, fetched_at) VALUES (1, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET crusade_id = excluded.crusade_id, season_number = excluded.season_number, phase = excluded.phase, " +
            "active_zone = excluded.active_zone, raw_response = excluded.raw_response, fetched_at = excluded.fetched_at",
        )
        .bind(crusadeId, seasonNumber, active.phase, active.activeZone, text, nowMs),
      db.prepare("DELETE FROM poller_planet_queue"),
      ...relevantIds.map((planetId, i) => {
        const raw = planetsById.get(planetId);
        return db
          .prepare(
            "INSERT INTO poller_planet_queue (cursor_position, planet_id, side_owner, owned_by_faction, points_for, points_against, struggle_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(i, planetId, raw?.sideOwner ?? null, raw?.ownedByFaction ?? null, raw?.pointsFor ?? null, raw?.pointsAgainst ?? null, raw?.struggleData ? JSON.stringify(raw.struggleData) : null);
      }),
      db
        .prepare(
          "UPDATE poller_epoch_state SET phase = ?, epoch_started_at = ?, cursor = 0, crusade_id = ?, season_number = ?, session_id = ?, session_issued_at = ? WHERE id = 1",
        )
        .bind(relevantIds.length > 0 ? "planets" : "awaiting_epoch", nowMs, crusadeId, seasonNumber, session.sessionId, issuedAt),
      release,
    ];
    await db.batch(statements);
    return true;
  }

  // state.phase === "planets"
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

  // Isolated from the history write below (and from each other across planets) - one planet's bad
  // leaderboard fetch never blocks its own history recording or any other planet's progress.
  try {
    const ids = allLeaderboardIdsForPlanet(state.crusade_id ?? "", state.season_number ?? 0, planet.planetId);
    const text = await fetchLeaderboardTextWithSession(session, userId, ids);
    countFetches(1);
    statements.push(
      db
        .prepare(
          "INSERT INTO planet_leaderboard_cache (planet_id, raw_leaderboards, fetched_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(planet_id) DO UPDATE SET raw_leaderboards = excluded.raw_leaderboards, fetched_at = excluded.fetched_at",
        )
        .bind(planet.planetId, text, nowMs),
    );
  } catch (error) {
    console.error(`[poller] planet ${planet.planetId} leaderboard fetch failed`, error);
  }

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

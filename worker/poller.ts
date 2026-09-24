// Scheduled background poller (see worker/index.ts's `scheduled` export, wired to a 1-minute Cron
// Trigger in wrangler.toml). Refreshes the public, account-agnostic crusade/leaderboard cache so
// anonymous visitors (and logged-in users' first paint) never have to wait on a live Tacticus call.
//
// Deliberately does NOT touch any Loki response before storing it - each tick stores the complete,
// untouched object fetchCrusadeDataWithSession/fetchLeaderboardDataWithSession returned, as one
// TEXT column each. Fields are read off that object in memory (phase/activeZone/crusadeId/
// seasonNumber) only to decide what to fetch next - that's unavoidable control flow, never applied
// to the stored copy. All interpretation (envelope-unwrapping, CrusadePlanet[] construction,
// building SideLeaderboardResult/FactionLeaderboardResult from raw entries) happens client-side, in
// src/api/fetch-crusade-data.ts, reused by src/api/crusade-cache-seed.ts - once per page load, not
// once per planet per minute.
import planetData from "../src/assets/planet-data.json";
import { FACTION_SIDE } from "../src/factions/faction-side";
import { bootstrapSession, environmentConfig, fetchCrusadeDataWithSession, fetchLeaderboardDataWithSession, type Session } from "./loki-client";

// The 22 faction ids, reused as-is (no Tauri/browser coupling in faction-side.ts, unlike
// fetch-crusade-data.ts, so no need to duplicate this list).
const ALL_FACTION_IDS = Object.keys(FACTION_SIDE);

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // no documented Loki session TTL - defensive reuse window
const CRUSADE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PLANETS_PER_TICK = 20; // see subrequest-budget arithmetic in the implementation plan

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
  const planets = planetData as { planetId: string; zone: number }[];
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

// Rolling-cursor math: takes the next `batchSize` ids starting at cursorIndex (wrapping around),
// and self-corrects if the relevant planet set shrank since the cursor was last saved (e.g. a
// phase change from STRUGGLE's 146 planets down to a single CRUSADE zone's ~20-29).
export function nextBatch(ids: string[], cursorIndex: number, batchSize: number): { batch: string[]; nextCursor: number } {
  if (ids.length === 0) return { batch: [], nextCursor: 0 };
  const start = cursorIndex % ids.length;
  const batch = [...ids.slice(start), ...ids.slice(0, start)].slice(0, batchSize);
  return { batch, nextCursor: (start + batch.length) % ids.length };
}

interface PollerStateRow {
  session_id: string | null;
  session_issued_at: number | null;
  last_crusade_refresh_at: number | null;
  cursor_index: number;
}

const DEFAULT_POLLER_STATE: PollerStateRow = { session_id: null, session_issued_at: null, last_crusade_refresh_at: null, cursor_index: 0 };

async function readPollerState(db: D1Database): Promise<PollerStateRow> {
  const row = await db
    .prepare("SELECT session_id, session_issued_at, last_crusade_refresh_at, cursor_index FROM poller_state WHERE id = 1")
    .first<PollerStateRow>();
  return row ?? DEFAULT_POLLER_STATE;
}

async function writePollerState(db: D1Database, state: PollerStateRow): Promise<void> {
  await db
    .prepare(
      "INSERT INTO poller_state (id, session_id, session_issued_at, last_crusade_refresh_at, cursor_index) VALUES (1, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, session_issued_at = excluded.session_issued_at, " +
        "last_crusade_refresh_at = excluded.last_crusade_refresh_at, cursor_index = excluded.cursor_index",
    )
    .bind(state.session_id, state.session_issued_at, state.last_crusade_refresh_at, state.cursor_index)
    .run();
}

interface SnapshotMeta {
  crusadeId: string;
  seasonNumber: number;
  phase: string | null;
  activeZone: number | null;
}

async function readSnapshotMeta(db: D1Database): Promise<SnapshotMeta> {
  const row = await db
    .prepare("SELECT crusade_id, season_number, phase, active_zone FROM crusade_snapshot_cache WHERE id = 1")
    .first<{ crusade_id: string; season_number: number; phase: string | null; active_zone: number | null }>();
  return row
    ? { crusadeId: row.crusade_id, seasonNumber: row.season_number, phase: row.phase, activeZone: row.active_zone }
    : { crusadeId: "", seasonNumber: 0, phase: null, activeZone: null };
}

async function writeCrusadeSnapshot(db: D1Database, meta: SnapshotMeta, rawResponse: unknown, fetchedAt: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO crusade_snapshot_cache (id, crusade_id, season_number, phase, active_zone, raw_response, fetched_at) VALUES (1, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET crusade_id = excluded.crusade_id, season_number = excluded.season_number, phase = excluded.phase, " +
        "active_zone = excluded.active_zone, raw_response = excluded.raw_response, fetched_at = excluded.fetched_at",
    )
    .bind(meta.crusadeId, meta.seasonNumber, meta.phase, meta.activeZone, JSON.stringify(rawResponse), fetchedAt)
    .run();
}

async function upsertPlanetLeaderboard(db: D1Database, planetId: string, rawLeaderboards: unknown, fetchedAt: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO planet_leaderboard_cache (planet_id, raw_leaderboards, fetched_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(planet_id) DO UPDATE SET raw_leaderboards = excluded.raw_leaderboards, fetched_at = excluded.fetched_at",
    )
    .bind(planetId, JSON.stringify(rawLeaderboards), fetchedAt)
    .run();
}

const POLLER_ENVIRONMENT = "prod"; // mirrors src/track-usage.ts's prod-only policy; QA isn't public-facing

export async function runPollerTick(db: D1Database, userId: string, clientSecret: string): Promise<void> {
  const now = Date.now();
  const state = await readPollerState(db);

  // Reconstructing a cached session is a pure local lookup (environmentConfig), no network call -
  // this is what lets most ticks skip the 2-subrequest APP_START+CONNECT bootstrap entirely.
  const config = environmentConfig(POLLER_ENVIRONMENT);
  let session: Session | null =
    state.session_id !== null && state.session_issued_at !== null && now - state.session_issued_at < SESSION_MAX_AGE_MS
      ? { config, baseUrl: `${config.baseUrl}/${userId}`, sessionId: state.session_id }
      : null;
  let sessionIssuedAt = state.session_issued_at;

  async function ensureSession(): Promise<Session> {
    if (session) return session;
    session = await bootstrapSession(POLLER_ENVIRONMENT, userId, clientSecret, "");
    sessionIssuedAt = now;
    return session;
  }

  // One re-bootstrap-and-retry on any failure - covers a session that expired despite the TTL
  // heuristic, and the very first call of a tick with no cached session at all.
  async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
    try {
      return await fn(await ensureSession());
    } catch (error) {
      console.error("[poller] call failed, re-bootstrapping once", error);
      session = null;
      return fn(await ensureSession());
    }
  }

  try {
    let meta: SnapshotMeta;
    const needsCrusadeRefresh = state.last_crusade_refresh_at === null || now - state.last_crusade_refresh_at >= CRUSADE_REFRESH_INTERVAL_MS;

    if (needsCrusadeRefresh) {
      // raw is stored verbatim below (writeCrusadeSnapshot) - drilling into it here is only ever
      // done to decide what to fetch next, never applied to the stored copy.
      const raw: any = await withSession((s) => fetchCrusadeDataWithSession(s, userId));
      const data = raw?.eventResults?.[0]?.eventResponseData;
      const active = findActivePhase(data?.downtimePhase, data?.crusadePhases ?? [], data?.strugglePhase);
      meta = { crusadeId: data?.crusadeId ?? "", seasonNumber: data?.seasonNumber ?? 0, phase: active.phase, activeZone: active.activeZone };
      await writeCrusadeSnapshot(db, meta, raw, now);
    } else {
      meta = await readSnapshotMeta(db);
    }

    const relevantIds = relevantPlanetIds(meta.phase, meta.activeZone);
    const { batch, nextCursor } = nextBatch(relevantIds, state.cursor_index, PLANETS_PER_TICK);

    for (const planetId of batch) {
      try {
        const ids = allLeaderboardIdsForPlanet(meta.crusadeId, meta.seasonNumber, planetId);
        const raw = await withSession((s) => fetchLeaderboardDataWithSession(s, userId, ids));
        await upsertPlanetLeaderboard(db, planetId, raw, now);
      } catch (error) {
        console.error(`[poller] planet ${planetId} failed`, error); // isolated - one bad planet doesn't abort the tick
      }
    }

    await writePollerState(db, {
      session_id: session?.sessionId ?? null,
      session_issued_at: sessionIssuedAt,
      last_crusade_refresh_at: needsCrusadeRefresh ? now : state.last_crusade_refresh_at,
      cursor_index: nextCursor,
    });
  } catch (error) {
    console.error("[poller] tick failed", error);
    // Force the next tick to re-bootstrap rather than retry a possibly-broken session.
    await writePollerState(db, { ...state, session_id: null }).catch(() => {});
  }
}

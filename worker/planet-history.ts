// Persists a rolling, append-only points-remaining history for every Domination planet, written by
// the poller (worker/poller.ts) on its existing once-every-5-minutes crusade-refresh cadence - see
// migrations/0005_create_planet_history_tables.sql. Read back by GET /api/planet-history
// (worker/index.ts) to seed a freshly-tracked planet's graph (src/App.tsx) with everything recorded
// since the current capture cycle began, not just the window the user happened to be watching.
//
// pointsRemaining/isDominationSunk are reused as-is from src/crusade/crusade-domination-view-model.ts
// (confirmed Tauri/browser-free - its only import is the plain-interface src/api/types.ts), the same
// class of precedent as this worker already importing src/factions/faction-side.ts and
// src/assets/planet-data.json. rawPlanetToCrusadePlanet below is a small hand-written duplicate of
// src/api/fetch-crusade-data.ts's mapCrusadeResponseData per-planet mapping, following the exact
// precedent worker/poller.ts already set by duplicating findActivePhase rather than importing that
// file (which pulls in @tauri-apps/api/core).
import { isDominationSunk, pointsRemaining } from "../src/crusade/crusade-domination-view-model";
import type { CrusadePlanet } from "../src/api/types";

export interface PlanetHistorySample {
  atMs: number;
  imperialRemaining: number;
  devastationRemaining: number;
}

// Maps one raw planetsData[] entry (GET_CRUSADE's own shape, already in memory in worker/poller.ts
// during a crusade-refresh tick) into the CrusadePlanet shape pointsRemaining/isDominationSunk need.
// name/zone are never read by either of those, so cheap placeholders stand in rather than pulling in
// planet-data.json's name/zone lookup just for this.
export function rawPlanetToCrusadePlanet(raw: {
  planetId: string;
  sideOwner?: string;
  ownedByFaction?: string;
  pointsFor?: number;
  pointsAgainst?: number;
  struggleData?: CrusadePlanet["struggleData"];
}): CrusadePlanet {
  return {
    planetId: raw.planetId,
    name: raw.planetId,
    zone: null,
    sideOwner: raw.sideOwner,
    ownedByFaction: raw.ownedByFaction,
    pointsFor: raw.pointsFor,
    pointsAgainst: raw.pointsAgainst,
    struggleData: raw.struggleData,
  };
}

export interface PlanetHistoryRow {
  planetId: string;
  atMs: number;
  imperialRemaining: number;
  devastationRemaining: number;
  sunk: boolean;
}

// Pure: what to write for one planet at this tick. Only ever called on planets already filtered to
// struggleData != null (the caller's job - see worker/poller.ts), so pointsRemaining never returns
// Infinity here in practice.
export function buildHistoryRow(planet: CrusadePlanet, atMs: number): PlanetHistoryRow {
  const remaining = pointsRemaining(planet);
  return {
    planetId: planet.planetId,
    atMs,
    imperialRemaining: remaining.imperial,
    devastationRemaining: remaining.devastation,
    sunk: isDominationSunk(planet),
  };
}

// True only the instant a planet flips from sunk (captured/in cooldown) back to trackable - that's
// the one moment its history should be cleared and a new capture-cycle "era" begins. `null` means
// no prior history row exists yet for this planet (never clear something that isn't there).
export function isEraReset(lastKnownSunk: boolean | null, currentlySunk: boolean): boolean {
  return lastKnownSunk === true && currentlySunk === false;
}

interface HistoryStateRow {
  planet_id: string;
  last_sunk: number;
}

// Orchestrates one tick's worth of history writes for every (already struggleData-filtered) planet
// in one D1 round-trip: a single SELECT for every planet's last-known sunk state (not one query per
// planet), then a single db.batch() covering every INSERT, any era-reset DELETEs, and every
// planet_history_state upsert - deliberately cheap regardless of planet count, matching this
// poller's already-demonstrated CPU-budget discipline (see PLANETS_PER_TICK's own history in
// worker/poller.ts).
export async function recordHistoryTick(db: D1Database, planets: readonly CrusadePlanet[], nowMs: number): Promise<void> {
  if (planets.length === 0) return;

  const stateRows = await db.prepare("SELECT planet_id, last_sunk FROM planet_history_state").all<HistoryStateRow>();
  const lastSunkByPlanet = new Map<string, boolean>();
  for (const row of stateRows.results ?? []) {
    lastSunkByPlanet.set(row.planet_id, row.last_sunk === 1);
  }

  const statements: D1PreparedStatement[] = [];
  for (const planet of planets) {
    const row = buildHistoryRow(planet, nowMs);
    const lastSunk = lastSunkByPlanet.get(row.planetId) ?? null;
    if (isEraReset(lastSunk, row.sunk)) {
      statements.push(db.prepare("DELETE FROM planet_history WHERE planet_id = ?").bind(row.planetId));
    }
    statements.push(
      db
        .prepare("INSERT INTO planet_history (planet_id, at_ms, imperial_remaining, devastation_remaining) VALUES (?, ?, ?, ?)")
        .bind(row.planetId, row.atMs, row.imperialRemaining, row.devastationRemaining),
    );
    statements.push(
      db
        .prepare("INSERT INTO planet_history_state (planet_id, last_sunk) VALUES (?, ?) ON CONFLICT(planet_id) DO UPDATE SET last_sunk = excluded.last_sunk")
        .bind(row.planetId, row.sunk ? 1 : 0),
    );
  }
  await db.batch(statements);
}

interface HistoryRow {
  at_ms: number;
  imperial_remaining: number;
  devastation_remaining: number;
}

// Read glue for GET /api/planet-history (worker/index.ts) - the current era's full history for one
// planet, oldest first (matches TrackedPlanetSample's own ordering expectation client-side).
export async function getPlanetHistory(db: D1Database, planetId: string): Promise<PlanetHistorySample[]> {
  const result = await db
    .prepare("SELECT at_ms, imperial_remaining, devastation_remaining FROM planet_history WHERE planet_id = ? ORDER BY at_ms ASC")
    .bind(planetId)
    .all<HistoryRow>();
  return (result.results ?? []).map((row) => ({ atMs: row.at_ms, imperialRemaining: row.imperial_remaining, devastationRemaining: row.devastation_remaining }));
}

interface AllHistoryRow extends HistoryRow {
  planet_id: string;
}

// Read glue for GET /api/planet-history-all (worker/index.ts) - every planet's current-era history
// in one query/round-trip, grouped by planetId, instead of the Monitor tab issuing one
// getPlanetHistory request per planet. Same row shape/ordering as getPlanetHistory, just not
// filtered to one planet_id.
export async function getAllPlanetHistory(db: D1Database): Promise<Map<string, PlanetHistorySample[]>> {
  const result = await db
    .prepare("SELECT planet_id, at_ms, imperial_remaining, devastation_remaining FROM planet_history ORDER BY planet_id ASC, at_ms ASC")
    .all<AllHistoryRow>();
  const byPlanet = new Map<string, PlanetHistorySample[]>();
  for (const row of result.results ?? []) {
    const sample: PlanetHistorySample = { atMs: row.at_ms, imperialRemaining: row.imperial_remaining, devastationRemaining: row.devastation_remaining };
    const existing = byPlanet.get(row.planet_id);
    if (existing) existing.push(sample);
    else byPlanet.set(row.planet_id, [sample]);
  }
  return byPlanet;
}

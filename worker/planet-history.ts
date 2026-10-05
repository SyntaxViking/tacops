// Persists a rolling, append-only points-remaining history for every Domination planet, written by
// the poller (worker/poller.ts) on its existing once-every-5-minutes crusade-refresh cadence - see
// migrations/0007_planet_history_cache.sql. Read back by GET /api/planet-history (one planet) and
// GET /api/planet-history-all (every planet, for the Monitor tab) in worker/index.ts, to seed a
// freshly-tracked planet's graph (src/App.tsx) and Monitor's graphs with everything recorded since
// the current capture cycle began, not just the window the user happened to be watching.
//
// One row per planet (planet_history_cache), holding its whole current-era history as a single
// JSON-encoded array - NOT one row per planet per tick, which is what migrations/0005 originally
// shipped. That first version worked but didn't scale: by 2026-10-05 the old per-sample table had
// grown large enough that the Monitor tab's bulk read (one full-table scan per call) alone burned
// through ~83% of the account's entire 5-million-rows-read/day D1 budget in under 6 hours, from
// perfectly normal use (one or two people with Monitor open, each auto-refreshing every 5 minutes -
// see MonitorTab.tsx's HISTORY_REFRESH_MS). A bulk read here is now a fixed ~100-row read (one row
// per planet) no matter how much history has accumulated, and the once-every-5-minutes write is a
// single-row upsert per planet instead of 2-3 new rows (base table + its indexes) per planet, which
// also roughly halves the write-side cost the 2026-10-03 investigation addressed. migrations/0007
// backfills this table from the old planet_history/planet_history_state tables (left in place,
// unused, as a safety net) so no accumulated history was lost in the switch.
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

export interface HistoryCacheEntry {
  samples: PlanetHistorySample[];
  lastSunk: boolean;
}

// Pure: what one planet's cached entry becomes after recording one new tick's row - appends to its
// existing samples, or starts fresh with just the new sample on an era reset (sunk -> trackable) or
// when there's no existing entry yet (first tick ever recorded for this planet).
export function appendToHistoryCache(existing: HistoryCacheEntry | null, row: PlanetHistoryRow): HistoryCacheEntry {
  const sample: PlanetHistorySample = { atMs: row.atMs, imperialRemaining: row.imperialRemaining, devastationRemaining: row.devastationRemaining };
  const samples = !existing || isEraReset(existing.lastSunk, row.sunk) ? [sample] : [...existing.samples, sample];
  return { samples, lastSunk: row.sunk };
}

interface HistoryCacheRow {
  planet_id: string;
  samples: string;
  last_sunk: number;
}

// Orchestrates one tick's worth of history writes for every (already struggleData-filtered) planet
// in one D1 round-trip: a single SELECT of every planet's current cache row (not one query per
// planet, and bounded by planet count - not by how much history has accumulated), then a single
// db.batch() of one upsert per planet - deliberately cheap regardless of how long a capture cycle
// has been running, matching this poller's already-demonstrated CPU/row-budget discipline (see
// PLANETS_PER_TICK's own history in worker/poller.ts, and this file's own top-of-file comment).
export async function recordHistoryTick(db: D1Database, planets: readonly CrusadePlanet[], nowMs: number): Promise<void> {
  if (planets.length === 0) return;

  const cacheRows = await db.prepare("SELECT planet_id, samples, last_sunk FROM planet_history_cache").all<HistoryCacheRow>();
  const existingByPlanet = new Map<string, HistoryCacheEntry>();
  for (const row of cacheRows.results ?? []) {
    existingByPlanet.set(row.planet_id, { samples: JSON.parse(row.samples) as PlanetHistorySample[], lastSunk: row.last_sunk === 1 });
  }

  const statements: D1PreparedStatement[] = [];
  for (const planet of planets) {
    const row = buildHistoryRow(planet, nowMs);
    const updated = appendToHistoryCache(existingByPlanet.get(row.planetId) ?? null, row);
    statements.push(
      db
        .prepare(
          "INSERT INTO planet_history_cache (planet_id, samples, last_sunk, updated_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(planet_id) DO UPDATE SET samples = excluded.samples, last_sunk = excluded.last_sunk, updated_at = excluded.updated_at",
        )
        .bind(row.planetId, JSON.stringify(updated.samples), updated.lastSunk ? 1 : 0, nowMs),
    );
  }
  await db.batch(statements);
}

// Read glue for GET /api/planet-history (worker/index.ts) - the current era's full history for one
// planet, oldest first (matches TrackedPlanetSample's own ordering expectation client-side). A
// single-row read regardless of how much history that planet has accumulated.
export async function getPlanetHistory(db: D1Database, planetId: string): Promise<PlanetHistorySample[]> {
  const row = await db.prepare("SELECT samples FROM planet_history_cache WHERE planet_id = ?").bind(planetId).first<{ samples: string }>();
  return row ? (JSON.parse(row.samples) as PlanetHistorySample[]) : [];
}

// Read glue for GET /api/planet-history-all (worker/index.ts) - every planet's current-era history
// in one query/round-trip, grouped by planetId, instead of the Monitor tab issuing one
// getPlanetHistory request per planet. One row per planet (~100 total) regardless of how much
// history has accumulated per planet - see this file's top-of-file comment for why that matters.
export async function getAllPlanetHistory(db: D1Database): Promise<Map<string, PlanetHistorySample[]>> {
  const result = await db.prepare("SELECT planet_id, samples FROM planet_history_cache").all<{ planet_id: string; samples: string }>();
  const byPlanet = new Map<string, PlanetHistorySample[]>();
  for (const row of result.results ?? []) {
    byPlanet.set(row.planet_id, JSON.parse(row.samples) as PlanetHistorySample[]);
  }
  return byPlanet;
}

// Shared, account-agnostic per-planet leaderboard cache - the "grab the leaderboards" half of
// worker/poller.ts's checkpointed loop, and the backing store for GET /api/leaderboard-cache
// (worker/index.ts). Scope is deliberately narrower than a live per-account fetch
// (src/api/fetch-crusade-data.ts's fetchPlanetLeaderboard): myRank/myPoints/nearMe are never
// computed here at all (not merely stripped after the fact) - there's no account to be "mine" for
// data served to every visitor, including the logged-out home page this cache exists to drive.
// The per-faction player leaderboard (factionPlayerLeaderboardId) is out of scope for the same
// reason - it needs a specific account's own chosen faction to query.
import { fetchLeaderboardDataWithSession, type Session } from "./loki-client";
import { activeSeason } from "../src/season";
import type { CrusadeFactionStanding, LeaderboardBenchmark } from "../src/api/types";

// Byte-identical copy of src/api/fetch-crusade-data.ts's leaderboardIdsForPlanet - duplicated
// rather than imported for the same reason worker/poller.ts already duplicates findActivePhase
// (that module pulls in @tauri-apps/api/core). Keep the two in sync by hand if the id format
// ever changes.
export function leaderboardIdsForPlanet(crusadeId: string, seasonNumber: number, planetId: string) {
  const base = `${crusadeId}_${seasonNumber}_${planetId}`;
  return {
    factionFor: `crusadeFaction:crusade_leaderboard_planet_side_factions_${base}_for`,
    factionAgainst: `crusadeFaction:crusade_leaderboard_planet_side_factions_${base}_against`,
    playerFor: `crusadePlayer:crusade_leaderboard_planet_side_players_${base}_for`,
    playerAgainst: `crusadePlayer:crusade_leaderboard_planet_side_players_${base}_against`,
  };
}

interface LeaderboardRow {
  position: number;
  points: number;
  factionId?: string;
}

function parseRows(rows: any): LeaderboardRow[] {
  return (rows ?? []).map((e: any) => ({ position: e.position, points: e.points, factionId: e.factionId }));
}

interface RawLeaderboardEntry {
  numParticipants: number;
  topEntries: LeaderboardRow[];
}

// Simplified duplicate of src/api/fetch-crusade-data.ts's readLeaderboard - never reads
// myRank/myPoints/localEntries at all, since this cache is shared across every account (and
// anonymous visitors) alike. Same "numParticipants is the real presence signal" guard as the
// original - a missing/wrong leaderboardId type prefix doesn't error, it just echoes the id back
// with nothing in it. Exported for direct unit testing, same precedent as the original.
export function readLeaderboard(leaderboards: any, leaderboardId: string): RawLeaderboardEntry | null {
  const entry = leaderboards?.[leaderboardId];
  if (!entry || typeof entry.numParticipants !== "number") return null;
  return { numParticipants: entry.numParticipants, topEntries: parseRows(entry.topEntries) };
}

export function topFactionStandings(entry: RawLeaderboardEntry | null): CrusadeFactionStanding[] {
  return (entry?.topEntries ?? []).filter((e) => e.factionId).map((e) => ({ factionId: e.factionId!, points: e.points }));
}

// Same collapsed-view ranks as src/api/fetch-crusade-data.ts's BENCHMARK_RANKS.
const BENCHMARK_RANKS = [1, 5, 10, 25];

function buildBenchmarks(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  return BENCHMARK_RANKS.filter((rank) => entry.topEntries.some((e) => e.position === rank - 1)).map((rank) => ({
    rank,
    points: entry.topEntries.find((e) => e.position === rank - 1)!.points,
  }));
}

function buildTopEntries(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  return [...entry.topEntries].sort((a, b) => a.position - b.position).map((e) => ({ rank: e.position + 1, points: e.points }));
}

export interface SharedSideLeaderboard {
  numParticipants: number;
  benchmarks: LeaderboardBenchmark[];
  topEntries: LeaderboardBenchmark[];
}

export function buildSharedSide(entry: RawLeaderboardEntry | null): SharedSideLeaderboard | null {
  if (!entry) return null;
  return { numParticipants: entry.numParticipants, benchmarks: buildBenchmarks(entry), topEntries: buildTopEntries(entry) };
}

export interface SharedPlanetLeaderboardData {
  topFactionsFor: CrusadeFactionStanding[];
  topFactionsAgainst: CrusadeFactionStanding[];
  sideFor: SharedSideLeaderboard | null;
  sideAgainst: SharedSideLeaderboard | null;
}

export interface SharedPlanetLeaderboard extends SharedPlanetLeaderboardData {
  fetchedAt: number;
}

// Fetches and shapes one planet's shareable leaderboard data - the same 4 leaderboard ids
// fetchPlanetLeaderboard's "side" half queries (factionFor/factionAgainst/playerFor/
// playerAgainst), one GET_LEADERBOARD_2 call.
export async function fetchSharedPlanetLeaderboard(
  session: Session,
  userId: string,
  crusadeId: string,
  seasonNumber: number,
  planetId: string,
): Promise<SharedPlanetLeaderboardData> {
  const ids = leaderboardIdsForPlanet(crusadeId, seasonNumber, planetId);
  const { parsed } = await fetchLeaderboardDataWithSession(session, userId, [ids.factionFor, ids.factionAgainst, ids.playerFor, ids.playerAgainst]);
  const leaderboards = parsed?.eventResult?.eventResponseData?.leaderboards;

  const factionFor = readLeaderboard(leaderboards, ids.factionFor);
  const factionAgainst = readLeaderboard(leaderboards, ids.factionAgainst);
  const playerFor = readLeaderboard(leaderboards, ids.playerFor);
  const playerAgainst = readLeaderboard(leaderboards, ids.playerAgainst);

  return {
    topFactionsFor: topFactionStandings(factionFor),
    topFactionsAgainst: topFactionStandings(factionAgainst),
    sideFor: buildSharedSide(playerFor),
    sideAgainst: buildSharedSide(playerAgainst),
  };
}

export function buildLeaderboardCacheUpsertStatement(
  db: D1Database,
  planetId: string,
  data: SharedPlanetLeaderboardData,
  nowMs: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO shared_leaderboard_cache (planet_id, season, data, fetched_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(planet_id) DO UPDATE SET season = excluded.season, data = excluded.data, fetched_at = excluded.fetched_at",
    )
    .bind(planetId, activeSeason(nowMs), JSON.stringify(data), nowMs);
}

interface CacheRow {
  planet_id: string;
  data: string;
  fetched_at: number;
}

// Read glue for GET /api/leaderboard-cache (worker/index.ts) - every planet's cached, shareable
// leaderboard data in one query, filtered to the active season the same way
// worker/planet-history.ts's getAllPlanetHistory treats a season mismatch as "nothing stored".
export async function getLeaderboardCache(db: D1Database): Promise<Record<string, SharedPlanetLeaderboard>> {
  const result = await db
    .prepare("SELECT planet_id, data, fetched_at FROM shared_leaderboard_cache WHERE season = ?")
    .bind(activeSeason())
    .all<CacheRow>();
  const entries: Record<string, SharedPlanetLeaderboard> = {};
  for (const row of result.results ?? []) {
    entries[row.planet_id] = { ...JSON.parse(row.data), fetchedAt: row.fetched_at };
  }
  return entries;
}

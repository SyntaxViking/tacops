// Shared, account-agnostic per-planet leaderboard cache - the "grab the leaderboards" half of
// worker/poller.ts's checkpointed loop, and the backing store for GET /api/leaderboard-cache
// (worker/index.ts). Scope is deliberately narrower than a live per-account fetch
// (src/api/fetch-crusade-data.ts's fetchPlanetLeaderboard): myRank/myPoints/nearMe are never
// forwarded into anything this file builds - there's no account to be "mine" for data served to
// every visitor, including the logged-out home page this cache exists to drive.
//
// This matters beyond just UX: the poller fetches every leaderboard using one dedicated service
// account's own credentials (POLLER_USER_ID/POLLER_CLIENT_SECRET), so Loki's raw response
// legitimately carries a myRank/myPoints for THAT account wherever it happens to rank - completely
// unrelated to whoever ends up viewing the cached data. readLeaderboard (imported below from the
// shared parsing module, same one the client's own live fetch uses) DOES return those fields when
// present - that's correct there, since it's always called with the real logged-in viewer's own
// credentials. buildSharedSide below enforces the cutoff for THIS file: it only ever destructures
// numParticipants/topEntries off whatever readLeaderboard returns, into SharedSideLeaderboard - a
// type with no myRank/myPoints/nearMe field at all. Never widen that type or spread a raw entry
// into it - doing so would show a random visitor the poller's own account's rank as their own.
import { fetchLeaderboardDataWithSession, type Session } from "./loki-client";
import { activeSeason } from "../src/season";
import { FACTION_SIDE } from "../src/factions/faction-side";
import {
  factionPlayerLeaderboardId,
  leaderboardIdsForPlanet,
  readLeaderboard,
  topFactionStandings,
  buildBenchmarks,
  buildTopEntries,
  type RawLeaderboardEntry,
} from "../src/crusade/leaderboard-parsing";
import type { CrusadeFactionStanding, LeaderboardBenchmark } from "../src/api/types";

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
  // One specific faction's players ranked against each other (distinct from topFactionsFor/
  // topFactionsAgainst above, which are the account-independent faction-level aggregate) - keyed
  // by factionId, covering every faction (src/factions/faction-side.ts's FACTION_SIDE) so any
  // visitor can pick any faction on the logged-out home page, or a logged-in user's own faction
  // can be looked up immediately at first paint. Missing key (not a stored null) means that
  // faction's leaderboard didn't come back for this planet.
  perFaction: Record<string, SharedSideLeaderboard>;
}

export interface SharedPlanetLeaderboard extends SharedPlanetLeaderboardData {
  fetchedAt: number;
}

// Fetches and shapes one planet's shareable leaderboard data: the same 4 side-leaderboard ids
// fetchPlanetLeaderboard's "side" half queries (factionFor/factionAgainst/playerFor/playerAgainst),
// plus every faction's own player leaderboard (factionPlayerLeaderboardId, one id per faction in
// FACTION_SIDE) - all batched into one GET_LEADERBOARD_2 call via fetchLeaderboardDataWithSession,
// which already accepts an arbitrary id list, so this stays a single network round trip regardless
// of id count.
export async function fetchSharedPlanetLeaderboard(
  session: Session,
  userId: string,
  crusadeId: string,
  seasonNumber: number,
  planetId: string,
): Promise<SharedPlanetLeaderboardData> {
  const ids = leaderboardIdsForPlanet(crusadeId, seasonNumber, planetId);
  const factionIds = Object.keys(FACTION_SIDE);
  const perFactionIds = factionIds.map((factionId) => factionPlayerLeaderboardId(crusadeId, seasonNumber, planetId, factionId));

  const { parsed } = await fetchLeaderboardDataWithSession(session, userId, [ids.factionFor, ids.factionAgainst, ids.playerFor, ids.playerAgainst, ...perFactionIds]);
  const leaderboards = parsed?.eventResult?.eventResponseData?.leaderboards;

  const factionFor = readLeaderboard(leaderboards, ids.factionFor, userId);
  const factionAgainst = readLeaderboard(leaderboards, ids.factionAgainst, userId);
  const playerFor = readLeaderboard(leaderboards, ids.playerFor, userId);
  const playerAgainst = readLeaderboard(leaderboards, ids.playerAgainst, userId);

  const perFaction: Record<string, SharedSideLeaderboard> = {};
  for (let i = 0; i < factionIds.length; i++) {
    const shared = buildSharedSide(readLeaderboard(leaderboards, perFactionIds[i], userId));
    if (shared) perFaction[factionIds[i]] = shared;
  }

  return {
    topFactionsFor: topFactionStandings(factionFor),
    topFactionsAgainst: topFactionStandings(factionAgainst),
    sideFor: buildSharedSide(playerFor),
    sideAgainst: buildSharedSide(playerAgainst),
    perFaction,
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

import { isTauri } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./invoke-with-timeout";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { mapCrusadeResponseData } from "../crusade/crusade-data-mapping";
import {
  factionPlayerLeaderboardId,
  leaderboardIdsForPlanet,
  readLeaderboard,
  topFactionStandings,
  buildBenchmarks,
  buildTopEntries,
  type RawLeaderboardEntry,
  type LeaderboardRow,
} from "../crusade/leaderboard-parsing";
import type { Credentials, Environment, FactionLeaderboardResult, LeaderboardBenchmark, PlanetLeaderboard, SideLeaderboardResult } from "./types";

export { mapCrusadeResponseData, findActivePhase, activePlanetIds, resolveMyFactionId } from "../crusade/crusade-data-mapping";
export { leaderboardIdsForPlanet, factionPlayerLeaderboardId, readLeaderboard, topFactionStandings } from "../crusade/leaderboard-parsing";

// Both transports replay APP_START -> CONNECT -> GET_CRUSADE server-side, each individually
// bounded at 20s - same reasoning as fetchPlayerData's timeout.
export async function fetchCrusadeData(
  environment: Environment,
  webCredentials?: { userId: string; clientSecret: string },
) {
  const response = isTauri()
    ? await (async () => {
        const credentials = await invokeWithTimeout<Credentials>("find_credentials", { environment }, 20_000);
        return invokeWithTimeout<any>("fetch_crusade_data", { environment, ...credentials }, 60_000);
      })()
    : await fetchWithTimeout<any>("/api/fetch-crusade-data", { environment, ...webCredentials, snowId: "" }, 60_000);

  return mapCrusadeResponseData(response?.eventResults?.[0]?.eventResponseData);
}

// A player can "hop" planets and end up on a different side per-planet than their season-level
// chosenSide, so which of the two queried sides is "mine" can only be determined by which one
// actually has a myRank - there should only ever be at most one (confirmed by a real capture
// where only the _against side had myRank set while _for didn't, for the same planet).
function pickMine(forEntry: RawLeaderboardEntry | null, againstEntry: RawLeaderboardEntry | null): (RawLeaderboardEntry & { myRank: number }) | null {
  if (forEntry && forEntry.myRank !== null) return forEntry as RawLeaderboardEntry & { myRank: number };
  if (againstEntry && againstEntry.myRank !== null) return againstEntry as RawLeaderboardEntry & { myRank: number };
  return null;
}

// The expanded view's "your rank +/-2" window - empty when there's no personal rank to center it
// on. localEntries only comes back populated when myRank doesn't land in topEntries (see
// readLeaderboard) and may cover a wider window than +/-2, so both sources get pooled and clipped
// to exactly that range; deduping by position covers the (normally impossible) case of the same
// row appearing in both.
function buildNearMe(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  if (entry.myRank == null) return [];
  const byPosition = new Map<number, LeaderboardRow>();
  for (const row of [...entry.topEntries, ...entry.localEntries]) {
    const rank = row.position + 1;
    if (rank >= entry.myRank - 2 && rank <= entry.myRank + 2) byPosition.set(row.position, row);
  }
  return [...byPosition.values()]
    .map((row) => ({ rank: row.position + 1, points: row.points }))
    .sort((a, b) => a.rank - b.rank);
}

// chosenSide is only consulted as a fallback - when the player has no personal rank on either
// side (pickMine finds nothing), the breakpoints are still useful to judge whether it'd be worth
// moving here, so this falls back to showing whichever side matches the player's crusade-wide
// chosenSide (not both - per discussion, simpler to reason about one list than two).
export function mergeSideLeaderboard(
  forEntry: RawLeaderboardEntry | null,
  againstEntry: RawLeaderboardEntry | null,
  chosenSide: string,
): SideLeaderboardResult | null {
  const mine = pickMine(forEntry, againstEntry);
  if (mine) {
    return {
      numParticipants: mine.numParticipants,
      myRank: mine.myRank,
      myPoints: mine.myPoints,
      benchmarks: buildBenchmarks(mine),
      topEntries: buildTopEntries(mine),
      nearMe: buildNearMe(mine),
    };
  }
  const fallback = chosenSide.toLowerCase() === "for" ? forEntry : againstEntry;
  if (!fallback) return null;
  return {
    numParticipants: fallback.numParticipants,
    myRank: null,
    myPoints: null,
    benchmarks: buildBenchmarks(fallback),
    topEntries: buildTopEntries(fallback),
    nearMe: [],
  };
}

// Unlike the side (_players) leaderboard, the per-faction leaderboard
// (crusade_leaderboard_planet_faction_players_..._{factionId}) was never split by side to begin
// with - one leaderboard per named faction, no _for/_against variants - so there's nothing to
// merge here, just a direct read. Benchmarks show regardless of whether the player has a
// personal rank on this specific planet's faction leaderboard - these leaderboards have
// thousands of participants (same scale as the side leaderboard), so #1/#5/#10/#25 are just as
// useful for judging a planet the player hasn't touched yet as one they have.
export function buildFactionLeaderboard(entry: RawLeaderboardEntry | null): FactionLeaderboardResult | null {
  if (!entry) return null;
  return {
    numParticipants: entry.numParticipants,
    myRank: entry.myRank,
    myPoints: entry.myPoints,
    benchmarks: buildBenchmarks(entry),
    topEntries: buildTopEntries(entry),
    nearMe: buildNearMe(entry),
  };
}

async function fetchLeaderboards(
  environment: Environment,
  credentials: { userId: string; clientSecret: string; snowId: string },
  leaderboardIds: string[],
): Promise<any> {
  const response = isTauri()
    ? await invokeWithTimeout<any>("fetch_leaderboard_data", { environment, ...credentials, leaderboardIds }, 60_000)
    : await fetchWithTimeout<any>("/api/fetch-leaderboard-data", { environment, ...credentials, leaderboardIds }, 60_000);
  return response?.eventResult?.eventResponseData?.leaderboards;
}

// Single-planet replacement for the old all-planets-at-once fetchLeaderboardData - called
// repeatedly (initial load, rolling auto-refresh, manual refresh) by App.tsx's scheduler, one
// planet at a time, so each planet's card/row can update independently instead of the whole tab
// blocking until every planet finishes.
export async function fetchPlanetLeaderboard(
  environment: Environment,
  crusadeId: string,
  seasonNumber: number,
  chosenSide: string,
  planetId: string,
  myFactionId: string,
  webCredentials?: { userId: string; clientSecret: string },
): Promise<PlanetLeaderboard> {
  const credentials = isTauri()
    ? await invokeWithTimeout<Credentials>("find_credentials", { environment }, 20_000)
    : { userId: webCredentials?.userId ?? "", clientSecret: webCredentials?.clientSecret ?? "", snowId: "" };

  const ids = leaderboardIdsForPlanet(crusadeId, seasonNumber, planetId);
  const sideLeaderboards = await fetchLeaderboards(environment, credentials, [ids.factionFor, ids.factionAgainst, ids.playerFor, ids.playerAgainst]);

  const factionFor = readLeaderboard(sideLeaderboards, ids.factionFor, credentials.userId);
  const factionAgainst = readLeaderboard(sideLeaderboards, ids.factionAgainst, credentials.userId);
  const playerFor = readLeaderboard(sideLeaderboards, ids.playerFor, credentials.userId);
  const playerAgainst = readLeaderboard(sideLeaderboards, ids.playerAgainst, credentials.userId);

  // myFactionId comes from resolveMyFactionId (GET_CRUSADE's chosenSide/forFactionId/
  // againstFactionId) - always known up front, so this only skips as a defensive no-op if
  // GET_CRUSADE ever omits those fields (fetchCrusadeData defaults them to "").
  let faction: FactionLeaderboardResult | null = null;
  if (myFactionId) {
    const factionLeaderboardId = factionPlayerLeaderboardId(crusadeId, seasonNumber, planetId, myFactionId);
    const factionLeaderboards = await fetchLeaderboards(environment, credentials, [factionLeaderboardId]);
    faction = buildFactionLeaderboard(readLeaderboard(factionLeaderboards, factionLeaderboardId, credentials.userId));
  }

  return {
    planetId,
    topFactionsFor: topFactionStandings(factionFor),
    topFactionsAgainst: topFactionStandings(factionAgainst),
    side: mergeSideLeaderboard(playerFor, playerAgainst, chosenSide),
    faction,
    forParticipants: playerFor?.numParticipants ?? null,
    againstParticipants: playerAgainst?.numParticipants ?? null,
  };
}

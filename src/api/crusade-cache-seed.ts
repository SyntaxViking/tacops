// Turns the raw cache response from fetch-crusade-cache.ts into the same CrusadeData/
// PlanetRefreshEntry shapes App.tsx already works with. The cache stores each Loki response
// completely untouched (see worker/poller.ts) - so this is the one place in the whole feature that
// unwraps the envelope and reshapes anything, reusing fetch-crusade-data.ts's existing parsing
// (mapCrusadeResponseData, leaderboardIdsForPlanet, factionPlayerLeaderboardId, readLeaderboard,
// mergeSideLeaderboard, buildFactionLeaderboard) exactly as the live-fetch path does. Shared by
// AnonymousCrusadeSection (the only data an anonymous visitor ever sees) and App.tsx's go() (a
// logged-in user's fast-paint bootstrap, overwritten by the real live fetch moments later).
import {
  buildFactionLeaderboard,
  factionPlayerLeaderboardId,
  leaderboardIdsForPlanet,
  mapCrusadeResponseData,
  mergeSideLeaderboard,
  readLeaderboard,
  activePlanetIds,
} from "./fetch-crusade-data";
import { factionSide } from "../factions/faction-side";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";
import type { CrusadeData, PlanetLeaderboard, PlanetRefreshEntry } from "./types";

export interface SeededCrusadeState {
  crusadeData: CrusadeData | null;
  planetRefreshState: Map<string, PlanetRefreshEntry>;
}

// selectedFactionId is null for the logged-in bootstrap seed (App.tsx's go()) - side/faction stay
// null there, exactly as before, since the real live fetch takes over moments later. The anonymous
// view (AnonymousCrusadeSection) passes the visitor's picked faction, populating both with real
// benchmarks - side/faction leaderboards are public, per-planet data once stripped of
// myRank/myPoints (no personal identity to match against a cached response), unlike topFactionsFor/
// topFactionsAgainst which are no longer fetched at all (that was the "Leading Factions" list,
// dropped per product decision - always [] here now).
export function seedPlanetRefreshStateFromCache(cache: CrusadeCacheResponse, selectedFactionId: string | null = null): SeededCrusadeState {
  const planetRefreshState = new Map<string, PlanetRefreshEntry>();

  const crusadeResponseData = (cache.crusadeRaw as any)?.eventResults?.[0]?.eventResponseData;
  if (!crusadeResponseData) return { crusadeData: null, planetRefreshState };

  const crusadeData = mapCrusadeResponseData(crusadeResponseData);
  const planetIds = crusadeData.phase === "STRUGGLE" ? crusadeData.planets.map((p) => p.planetId) : activePlanetIds(crusadeData.activeZone);
  const selectedSide = selectedFactionId ? factionSide(selectedFactionId) : undefined;

  for (const planetId of planetIds) {
    const cached = cache.leaderboards[planetId];
    if (!cached) {
      planetRefreshState.set(planetId, { leaderboard: null, lastSuccessAt: null, lastAttemptAt: null, lastAttemptFailed: false, isLoading: false });
      continue;
    }

    const leaderboards = (cached.raw as any)?.eventResult?.eventResponseData?.leaderboards;
    const ids = leaderboardIdsForPlanet(crusadeData.crusadeId, crusadeData.seasonNumber, planetId);
    const side =
      selectedSide != null
        ? mergeSideLeaderboard(readLeaderboard(leaderboards, ids.playerFor, ""), readLeaderboard(leaderboards, ids.playerAgainst, ""), selectedSide)
        : null;
    const faction =
      selectedFactionId != null
        ? buildFactionLeaderboard(
            readLeaderboard(leaderboards, factionPlayerLeaderboardId(crusadeData.crusadeId, crusadeData.seasonNumber, planetId, selectedFactionId), ""),
          )
        : null;

    const leaderboard: PlanetLeaderboard = { planetId, topFactionsFor: [], topFactionsAgainst: [], side, faction };
    planetRefreshState.set(planetId, {
      leaderboard,
      lastSuccessAt: cached.fetchedAt,
      lastAttemptAt: cached.fetchedAt,
      lastAttemptFailed: false,
      isLoading: false,
    });
  }

  return { crusadeData, planetRefreshState };
}

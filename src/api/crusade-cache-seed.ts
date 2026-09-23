// Turns the raw cache response from fetch-crusade-cache.ts into the same CrusadeData/
// PlanetRefreshEntry shapes App.tsx already works with, reusing fetch-crusade-data.ts's existing
// parsing (mapCrusadeResponseData, leaderboardIdsForPlanet, readLeaderboard, topFactionStandings) -
// this is the one place any Loki response shape gets reshaped in this feature; the worker
// (worker/poller.ts, worker/crusade-cache.ts) never does. Shared by AnonymousCrusadeSection (the
// only data an anonymous visitor ever sees) and App.tsx's go() (a logged-in user's fast-paint
// bootstrap, overwritten by the real live fetch moments later).
import { activePlanetIds, leaderboardIdsForPlanet, mapCrusadeResponseData, readLeaderboard, topFactionStandings } from "./fetch-crusade-data";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";
import type { CrusadeData, PlanetLeaderboard, PlanetRefreshEntry } from "./types";

export interface SeededCrusadeState {
  crusadeData: CrusadeData | null;
  planetRefreshState: Map<string, PlanetRefreshEntry>;
}

export function seedPlanetRefreshStateFromCache(cache: CrusadeCacheResponse): SeededCrusadeState {
  const planetRefreshState = new Map<string, PlanetRefreshEntry>();
  if (!cache.crusadeRaw) return { crusadeData: null, planetRefreshState };

  const crusadeData = mapCrusadeResponseData(cache.crusadeRaw);
  const planetIds = crusadeData.phase === "STRUGGLE" ? crusadeData.planets.map((p) => p.planetId) : activePlanetIds(crusadeData.activeZone);

  for (const planetId of planetIds) {
    const cached = cache.leaderboards[planetId];
    if (!cached) {
      planetRefreshState.set(planetId, { leaderboard: null, lastSuccessAt: null, lastAttemptAt: null, lastAttemptFailed: false, isLoading: false });
      continue;
    }

    // side/faction are account-specific (a real player's own rank) and were never cached - the
    // poller has no personal identity to report one for. Only the faction-vs-faction breakdown is
    // ever populated from the cache.
    const ids = leaderboardIdsForPlanet(crusadeData.crusadeId, crusadeData.seasonNumber, planetId);
    const factionFor = readLeaderboard(cached.raw, ids.factionFor, "");
    const factionAgainst = readLeaderboard(cached.raw, ids.factionAgainst, "");
    const leaderboard: PlanetLeaderboard = {
      planetId,
      topFactionsFor: topFactionStandings(factionFor),
      topFactionsAgainst: topFactionStandings(factionAgainst),
      side: null,
      faction: null,
    };
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

// Turns the raw cache response from fetch-crusade-cache.ts into the same CrusadeData/
// PlanetRefreshEntry shapes App.tsx already works with. The cache stores the crusade snapshot
// completely untouched (see worker/poller.ts) - so this is the one place that unwraps the envelope
// and reshapes it, reusing fetch-crusade-data.ts's existing mapCrusadeResponseData exactly as the
// live-fetch path does. Shared by AnonymousCrusadeSection (the only data an anonymous visitor ever
// sees) and App.tsx's go() (a logged-in user's fast-paint bootstrap, overwritten by the real live
// fetch moments later).
//
// Leaderboard data is never part of this seed - the poller doesn't fetch it (see AGENTS.md), so
// every planet starts with no leaderboard at all. It only ever populates via a live per-planet
// fetch (starred/live-tracked/manually-refreshed planets) - see fetchOnePlanet in App.tsx.
import { mapCrusadeResponseData, activePlanetIds } from "./fetch-crusade-data";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";
import type { CrusadeData, PlanetRefreshEntry } from "./types";

export interface SeededCrusadeState {
  crusadeData: CrusadeData | null;
  planetRefreshState: Map<string, PlanetRefreshEntry>;
}

export function seedPlanetRefreshStateFromCache(cache: CrusadeCacheResponse): SeededCrusadeState {
  const planetRefreshState = new Map<string, PlanetRefreshEntry>();

  const crusadeResponseData = (cache.crusadeRaw as any)?.eventResults?.[0]?.eventResponseData;
  if (!crusadeResponseData) return { crusadeData: null, planetRefreshState };

  const crusadeData = mapCrusadeResponseData(crusadeResponseData);
  const planetIds = crusadeData.phase === "STRUGGLE" ? crusadeData.planets.map((p) => p.planetId) : activePlanetIds(crusadeData.activeZone);

  for (const planetId of planetIds) {
    planetRefreshState.set(planetId, { leaderboard: null, lastSuccessAt: null, lastAttemptAt: null, lastAttemptFailed: false, isLoading: false });
  }

  return { crusadeData, planetRefreshState };
}

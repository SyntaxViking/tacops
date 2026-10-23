// Turns the raw cache response from fetch-crusade-cache.ts into the same CrusadeData/
// PlanetRefreshEntry shapes App.tsx already works with. The cache stores the crusade snapshot
// completely untouched (see worker/poller.ts) - so this is the one place that unwraps the envelope
// and reshapes it, reusing fetch-crusade-data.ts's existing mapCrusadeResponseData exactly as the
// live-fetch path does. Shared by AnonymousCrusadeSection (the only data an anonymous visitor ever
// sees) and App.tsx's go() (a logged-in user's fast-paint bootstrap, overwritten by the real live
// fetch moments later).
//
// Leaderboard data starts null here - this function only seeds the crusade snapshot. It's filled
// in moments later by a separate fetchLeaderboardCache() call in App.tsx's go() (toSeededPlanetLeaderboard
// below), and kept fresh after that by the ~1-minute freshness-poll loop - see App.tsx.
import { mapCrusadeResponseData, activePlanetIds } from "./fetch-crusade-data";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";
import type { CrusadeData, PlanetLeaderboard, PlanetRefreshEntry, SharedPlanetLeaderboard } from "./types";

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

// Maps the shared, account-agnostic cache entry (worker/leaderboard-cache.ts) into the same
// per-account PlanetLeaderboard shape every existing Crusades-tab component already renders -
// myRank/myPoints/nearMe are always null/empty (there's no account behind a shared cache entry),
// the same "no personal rank, fall back to chosenSide" shape fetch-crusade-data.ts's own
// mergeSideLeaderboard already produces when a live fetch finds no personal rank either. Used by
// both App.tsx's login-time seed and its ~1-minute freshness-poll loop, and by
// AnonymousCrusadeSection.tsx (the logged-out home page).
//
// factionId picks which faction's player leaderboard populates `.faction` - the viewer's own (via
// resolveMyFactionId) for a logged-in account, or whichever faction is currently selected in the
// landing page's FactionPicker for an anonymous visitor; `null` leaves `.faction` null.
export function toSeededPlanetLeaderboard(planetId: string, cached: SharedPlanetLeaderboard, chosenSide: string, factionId: string | null): PlanetLeaderboard {
  const mine = chosenSide.toLowerCase() === "for" ? cached.sideFor : cached.sideAgainst;
  const factionEntry = factionId ? cached.perFaction?.[factionId] ?? null : null;
  return {
    planetId,
    topFactionsFor: cached.topFactionsFor,
    topFactionsAgainst: cached.topFactionsAgainst,
    side: mine ? { numParticipants: mine.numParticipants, myRank: null, myPoints: null, benchmarks: mine.benchmarks, topEntries: mine.topEntries, nearMe: [] } : null,
    faction: factionEntry
      ? { numParticipants: factionEntry.numParticipants, myRank: null, myPoints: null, benchmarks: factionEntry.benchmarks, topEntries: factionEntry.topEntries, nearMe: [] }
      : null,
    forParticipants: cached.sideFor?.numParticipants ?? null,
    againstParticipants: cached.sideAgainst?.numParticipants ?? null,
  };
}

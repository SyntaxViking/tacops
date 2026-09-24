import { useEffect, useMemo, useState } from "react";
import { CrusadeTab } from "./CrusadeTab";
import { FactionPicker } from "./FactionPicker";
import { fetchCrusadeCache, type CrusadeCacheResponse } from "../api/fetch-crusade-cache";
import { seedPlanetRefreshStateFromCache } from "../api/crusade-cache-seed";
import { getOrCreateAnonymousId } from "../api/anonymous-id";
import { trackAnonymousUsage } from "../track-usage";
import { factionSide } from "../factions/faction-side";
import type { DominationSortMode } from "../crusade/crusade-domination-view-model";
import type { CrusadeSectorMap } from "../api/types";

const SELECTED_FACTION_STORAGE_KEY = "tacops:selectedFactionId";
const EMPTY_FAVORITED_PLANET_IDS = new Set<string>();
// No sector map data exists for an anonymous visitor (it comes from a logged-in GET_PLAYER call) -
// clicking a planet during Domination opens an empty modal, an accepted minor limitation.
const EMPTY_SECTOR_MAP: CrusadeSectorMap = { planets: [], connections: [] };

// The home page's read-only crusade view for a visitor who hasn't pressed "8" (see App.tsx) - no
// credentials, no login form, just whatever the background poller (worker/poller.ts) has cached.
// Fetches once on mount and never again: no polling, no manual refresh - if the visitor wants
// fresher data, they refresh the page, per the product decision to keep this path simple for now.
export function AnonymousCrusadeSection() {
  const [selectedFactionId, setSelectedFactionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_FACTION_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  // Kept raw (not pre-seeded) because side/faction leaderboards depend on which faction is
  // picked, and picking happens after this loads - see the useMemo below, which recomputes
  // client-side (no new fetch) whenever selectedFactionId changes.
  const [cache, setCache] = useState<CrusadeCacheResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      void trackAnonymousUsage(getOrCreateAnonymousId());
    } catch (err) {
      console.error("[AnonymousCrusadeSection] trackAnonymousUsage failed", err);
    }
  }, []);

  useEffect(() => {
    fetchCrusadeCache()
      .then(setCache)
      .catch((err) => {
        console.error("[AnonymousCrusadeSection] fetchCrusadeCache failed", err);
        setError(`Failed to load cached crusade data: ${err}`);
      });
  }, []);

  function selectFaction(factionId: string) {
    setSelectedFactionId(factionId);
    try {
      localStorage.setItem(SELECTED_FACTION_STORAGE_KEY, factionId);
    } catch {
      // best-effort - a picked faction just won't be remembered next visit
    }
  }

  const { crusadeData, planetRefreshState } = useMemo(
    () => (cache ? seedPlanetRefreshStateFromCache(cache, selectedFactionId) : { crusadeData: null, planetRefreshState: new Map() }),
    [cache, selectedFactionId],
  );

  // "for" = Imperial factions, "against" = Xenos/Chaos (Devastation) - see factionSide. Biases
  // initial Domination sort order toward the visitor's chosen side.
  const selectedSide = selectedFactionId ? factionSide(selectedFactionId) : undefined;
  const defaultDominationSortMode: DominationSortMode | undefined =
    selectedSide === "against" ? "devastationFirst" : selectedSide === "for" ? "imperialFirst" : undefined;

  return (
    <div className="w-full max-w-4xl">
      <FactionPicker selectedFactionId={selectedFactionId} onSelect={selectFaction} />
      {!selectedFactionId && <p className="mt-2 text-sm opacity-70">Pick a faction above to see its leaderboard standings on every planet.</p>}
      <CrusadeTab
        crusadeData={crusadeData}
        planetRefreshState={planetRefreshState}
        sectorMap={EMPTY_SECTOR_MAP}
        error={error}
        viewMode="cards"
        favoritedPlanetIds={EMPTY_FAVORITED_PLANET_IDS}
        defaultDominationSortMode={defaultDominationSortMode}
        // onRefreshPlanet / onToggleFavoritePlanet intentionally omitted - suppresses those icons
        // (see CrusadeTab's props), since anonymous visitors can't star or refresh planets.
      />
    </div>
  );
}

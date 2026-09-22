import { useState } from "react";
import { CrusadePlanetsTable } from "./CrusadePlanetsTable";
import { CrusadePlanetsCards } from "./CrusadePlanetsCards";
import { CrusadeDominationCards } from "./CrusadeDominationCards";
import { CrusadeDominationTable } from "./CrusadeDominationTable";
import { DominationSortModeToggle } from "./DominationSortModeToggle";
import { DominationTopTenFilter } from "./DominationTopTenFilter";
import { PlanetSectorMapModal } from "./PlanetSectorMapModal";
import {
  parsePositiveIntFilter,
  passesDominationFilters,
  sortDominationPlanets,
  sortPlanetsRankedFirst,
  type DominationSortMode,
} from "../crusade/crusade-domination-view-model";
import { computeSectorMap } from "../crusade/crusade-sector-map-view-model";
import type { ViewMode } from "./ViewModeToggle";
import type { CrusadeData, CrusadeSectorMap, PlanetLeaderboard, PlanetRefreshEntry } from "../api/types";

interface CrusadeTabProps {
  crusadeData: CrusadeData | null;
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  sectorMap: CrusadeSectorMap;
  error: string | null;
  viewMode: ViewMode;
  onRefreshPlanet: (planetId: string) => void;
  favoritedPlanetIds: ReadonlySet<string>;
  onToggleFavoritePlanet: (planetId: string) => void;
}

export function CrusadeTab({
  crusadeData,
  planetRefreshState,
  sectorMap,
  error,
  viewMode,
  onRefreshPlanet,
  favoritedPlanetIds,
  onToggleFavoritePlanet,
}: CrusadeTabProps) {
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(null);
  const [dominationSortMode, setDominationSortMode] = useState<DominationSortMode>("closestToCapture");
  const [maxSideInput, setMaxSideInput] = useState("");
  const [maxFactionInput, setMaxFactionInput] = useState("");

  if (!crusadeData) {
    return error ? (
      <pre className="mt-4 w-full overflow-x-auto whitespace-pre-wrap rounded border border-red-400 bg-red-50 p-3 text-left text-sm text-red-700 dark:border-red-600 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </pre>
    ) : (
      <p>No crusade data loaded.</p>
    );
  }

  // Leaderboard-only view, used solely to feed the existing sort helpers below (which take
  // Map<string, PlanetLeaderboard>, not the richer per-planet refresh state) - entries with no
  // leaderboard loaded yet are simply omitted, exactly like the old planetLeaderboards array
  // before this planet's first fetch completed.
  const leaderboardByPlanet = new Map<string, PlanetLeaderboard>();
  for (const [planetId, entry] of planetRefreshState) {
    if (entry.leaderboard) leaderboardByPlanet.set(planetId, entry.leaderboard);
  }

  const selectedPlanetZone = selectedPlanetId
    ? (crusadeData.planets.find((p) => p.planetId === selectedPlanetId)?.zone ?? null)
    : null;
  const sectorMapModal =
    selectedPlanetId !== null && selectedPlanetZone !== null ? (
      <PlanetSectorMapModal
        sectorMapData={computeSectorMap(selectedPlanetZone, sectorMap, crusadeData.planets)}
        highlightPlanetId={selectedPlanetId}
        onClose={() => setSelectedPlanetId(null)}
      />
    ) : null;

  if (crusadeData.phase === "STRUGGLE") {
    // Domination phase: every planet is contestable at once (no zone filter), ordered by
    // opportunity - see sortDominationPlanets. Filtering against planetRefreshState (not
    // leaderboardByPlanet) is what makes pre-population work - it's seeded for every active
    // planet immediately in App.tsx's go(), long before any leaderboard fetch completes.
    const dominationPlanets = sortDominationPlanets(
      crusadeData.planets.filter((p) => planetRefreshState.has(p.planetId)),
      leaderboardByPlanet,
      favoritedPlanetIds,
      dominationSortMode,
    );
    if (dominationPlanets.length === 0) {
      return <p>No planet data loaded yet.</p>;
    }
    // Display-only - deliberately doesn't touch planetRefreshState/dominationPlanets above, so a
    // filtered-out planet keeps refreshing in the background and can reappear once its leaderboard
    // no longer exceeds the threshold.
    const maxSide = parsePositiveIntFilter(maxSideInput);
    const maxFaction = parsePositiveIntFilter(maxFactionInput);
    const visibleDominationPlanets = dominationPlanets.filter((p) =>
      passesDominationFilters(leaderboardByPlanet.get(p.planetId), maxSide, maxFaction),
    );
    return (
      <>
        <DominationSortModeToggle value={dominationSortMode} onChange={setDominationSortMode} />
        <DominationTopTenFilter
          maxSideInput={maxSideInput}
          onChangeMaxSideInput={setMaxSideInput}
          maxFactionInput={maxFactionInput}
          onChangeMaxFactionInput={setMaxFactionInput}
        />
        {viewMode === "table" ? (
          <CrusadeDominationTable
            planets={visibleDominationPlanets}
            planetRefreshState={planetRefreshState}
            onSelectPlanet={setSelectedPlanetId}
            onRefreshPlanet={onRefreshPlanet}
            favoritedPlanetIds={favoritedPlanetIds}
            onToggleFavoritePlanet={onToggleFavoritePlanet}
          />
        ) : (
          <CrusadeDominationCards
            planets={visibleDominationPlanets}
            planetRefreshState={planetRefreshState}
            onSelectPlanet={setSelectedPlanetId}
            onRefreshPlanet={onRefreshPlanet}
            favoritedPlanetIds={favoritedPlanetIds}
            onToggleFavoritePlanet={onToggleFavoritePlanet}
          />
        )}
        {sectorMapModal}
      </>
    );
  }

  if (crusadeData.activeZone === null) {
    return <p>No crusade zone is currently active (between phases).</p>;
  }

  // Starred, then ranked, then everyone else (see sortPlanetsRankedFirst), each group ordered
  // ascending by Faction Leaderboard reference score - a rough "how competitive is this planet"
  // signal (see fetch-crusade-data.ts's pickReferenceScore). Planets with no score yet (still
  // loading, or genuinely no faction leaderboard data) sort last within their group rather than
  // being dropped.
  const activePlanets = sortPlanetsRankedFirst(
    crusadeData.planets.filter((p) => planetRefreshState.has(p.planetId)),
    leaderboardByPlanet,
    favoritedPlanetIds,
    (a, b) => {
      const scoreA = leaderboardByPlanet.get(a.planetId)?.faction?.referenceScore?.points ?? Infinity;
      const scoreB = leaderboardByPlanet.get(b.planetId)?.faction?.referenceScore?.points ?? Infinity;
      return scoreA - scoreB;
    },
  );

  if (activePlanets.length === 0) {
    return <p>No active-zone planet data loaded yet.</p>;
  }

  return viewMode === "table" ? (
    <CrusadePlanetsTable
      planets={activePlanets}
      planetRefreshState={planetRefreshState}
      onRefreshPlanet={onRefreshPlanet}
      favoritedPlanetIds={favoritedPlanetIds}
      onToggleFavoritePlanet={onToggleFavoritePlanet}
    />
  ) : (
    <CrusadePlanetsCards
      planets={activePlanets}
      planetRefreshState={planetRefreshState}
      onRefreshPlanet={onRefreshPlanet}
      favoritedPlanetIds={favoritedPlanetIds}
      onToggleFavoritePlanet={onToggleFavoritePlanet}
    />
  );
}

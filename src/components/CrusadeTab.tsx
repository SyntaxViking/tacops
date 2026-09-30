import { useEffect, useState } from "react";
import { CrusadePlanetsTable } from "./CrusadePlanetsTable";
import { CrusadePlanetsCards } from "./CrusadePlanetsCards";
import { CrusadeDominationCards } from "./CrusadeDominationCards";
import { CrusadeDominationTable } from "./CrusadeDominationTable";
import { DominationSortModeToggle } from "./DominationSortModeToggle";
import { DominationTopTenFilter } from "./DominationTopTenFilter";
import { PlanetSectorMapModal } from "./PlanetSectorMapModal";
import { PlanetTrackerGraph } from "./PlanetTrackerGraph";
import {
  parsePositiveIntFilter,
  passesDominationFilters,
  sortDominationPlanets,
  sortPlanetsRankedFirst,
  type DominationSortMode,
} from "../crusade/crusade-domination-view-model";
import { adjacentZone, computeAllSectorsMap, computeSectorMap, sectorZones } from "../crusade/crusade-sector-map-view-model";
import type { TrackedPlanetState } from "../crusade/planet-tracker-view-model";
import type { ViewMode } from "./ViewModeToggle";
import type { CrusadeData, CrusadeSectorMap, PlanetLeaderboard, PlanetRefreshEntry } from "../api/types";

interface CrusadeTabProps {
  crusadeData: CrusadeData | null;
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  sectorMap: CrusadeSectorMap;
  error: string | null;
  viewMode: ViewMode;
  // Omitted entirely (rather than a separate readOnly flag) suppresses the star/refresh icons in
  // every child - see CrusadePlanetsTable/CrusadePlanetsCards/CrusadeDominationTable/
  // CrusadeDominationCards/CrusadePlanetCard/CrusadeDominationCard. Used by
  // AnonymousCrusadeSection, which has no account to refresh or favorite planets against.
  onRefreshPlanet?: (planetId: string) => void;
  favoritedPlanetIds: ReadonlySet<string>;
  onToggleFavoritePlanet?: (planetId: string) => void;
  // Lets a caller (the faction picker in AnonymousCrusadeSection) bias Domination sort order
  // toward the visitor's chosen side - re-synced whenever it changes (see the effect below), not
  // just on first mount, so picking a different faction mid-session actually re-sorts.
  defaultDominationSortMode?: DominationSortMode;
  // Omitted (like onRefreshPlanet/onToggleFavoritePlanet above) suppresses the track icon entirely
  // - AnonymousCrusadeSection has no account to track a planet's live refresh against.
  trackedPlanetId?: string | null;
  trackedPlanetState?: TrackedPlanetState | null;
  onToggleTrackPlanet?: (planetId: string) => void;
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
  defaultDominationSortMode,
  trackedPlanetId = null,
  trackedPlanetState = null,
  onToggleTrackPlanet,
}: CrusadeTabProps) {
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(null);
  // The sector the map modal is showing - starts at the clicked planet's sector but can be stepped
  // to others with the modal's arrows, so it's its own state rather than derived from the planet.
  const [viewedZone, setViewedZone] = useState<number | null>(null);
  const [dominationSortMode, setDominationSortMode] = useState<DominationSortMode>(defaultDominationSortMode ?? "closestToCapture");
  const [maxSideInput, setMaxSideInput] = useState("");
  const [maxFactionInput, setMaxFactionInput] = useState("");

  // defaultDominationSortMode's initial value (above) only ever applies on first mount - without
  // this, picking a different faction after the initial load wouldn't actually change sort order.
  useEffect(() => {
    if (defaultDominationSortMode) setDominationSortMode(defaultDominationSortMode);
  }, [defaultDominationSortMode]);

  // Drives PlanetTrackerGraph's "elapsed" caption while a planet is tracked and live - the actual
  // line data comes entirely from trackedPlanetState's own samples (App.tsx owns that), this is
  // only for the ticking "Ns elapsed" text. Stops (and the graph freezes in place) once frozen -
  // deliberately keyed on trackedPlanetId/frozen rather than trackedPlanetState itself, since a new
  // sample replaces that object every refresh and would otherwise restart this interval constantly.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!trackedPlanetId || trackedPlanetState?.frozen) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [trackedPlanetId, trackedPlanetState?.frozen]);

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

  const crusadePlanets = crusadeData.planets;
  function openSectorMap(planetId: string) {
    setSelectedPlanetId(planetId);
    setViewedZone(crusadePlanets.find((p) => p.planetId === planetId)?.zone ?? null);
  }
  function closeSectorMap() {
    setSelectedPlanetId(null);
    setViewedZone(null);
  }

  const zones = sectorZones(sectorMap);
  const sectorMapModal =
    selectedPlanetId !== null && viewedZone !== null ? (
      <PlanetSectorMapModal
        sectorMapData={computeSectorMap(viewedZone, sectorMap, crusadePlanets)}
        allSectorsMapData={computeAllSectorsMap(sectorMap, crusadePlanets)}
        highlightPlanetId={selectedPlanetId}
        onClose={closeSectorMap}
        onChangeSector={zones.length > 1 ? (direction) => setViewedZone(adjacentZone(zones, viewedZone, direction)) : undefined}
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
    let visibleDominationPlanets = dominationPlanets.filter((p) => passesDominationFilters(leaderboardByPlanet.get(p.planetId), maxSide, maxFaction));

    // The tracked planet is always first and always visible while tracked, regardless of sort mode
    // or the side/faction filters above - a user actively watching a capture race shouldn't have it
    // disappear because a filter now excludes it.
    if (trackedPlanetId) {
      const tracked = dominationPlanets.find((p) => p.planetId === trackedPlanetId) ?? crusadeData.planets.find((p) => p.planetId === trackedPlanetId);
      if (tracked) {
        visibleDominationPlanets = [tracked, ...visibleDominationPlanets.filter((p) => p.planetId !== trackedPlanetId)];
      }
    }

    const trackedPlanet = trackedPlanetId ? crusadeData.planets.find((p) => p.planetId === trackedPlanetId) : undefined;

    return (
      <>
        {trackedPlanetState && trackedPlanet && <PlanetTrackerGraph state={trackedPlanetState} planetName={trackedPlanet.name} nowMs={nowMs} />}
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
            onSelectPlanet={openSectorMap}
            onRefreshPlanet={onRefreshPlanet}
            favoritedPlanetIds={favoritedPlanetIds}
            onToggleFavoritePlanet={onToggleFavoritePlanet}
            trackedPlanetId={trackedPlanetId}
            onToggleTrackPlanet={onToggleTrackPlanet}
          />
        ) : (
          <CrusadeDominationCards
            planets={visibleDominationPlanets}
            planetRefreshState={planetRefreshState}
            onSelectPlanet={openSectorMap}
            onRefreshPlanet={onRefreshPlanet}
            favoritedPlanetIds={favoritedPlanetIds}
            onToggleFavoritePlanet={onToggleFavoritePlanet}
            trackedPlanetId={trackedPlanetId}
            onToggleTrackPlanet={onToggleTrackPlanet}
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
  // ascending by the deepest Faction Leaderboard rank actually returned - a rough "how
  // competitive is this planet" signal (the more points it takes to reach whatever rank is
  // visible, the tougher the planet). Planets with no score yet (still loading, or genuinely no
  // faction leaderboard data) sort last within their group rather than being dropped.
  const activePlanets = sortPlanetsRankedFirst(
    crusadeData.planets.filter((p) => planetRefreshState.has(p.planetId)),
    leaderboardByPlanet,
    favoritedPlanetIds,
    (a, b) => {
      const entriesA = leaderboardByPlanet.get(a.planetId)?.faction?.topEntries ?? [];
      const entriesB = leaderboardByPlanet.get(b.planetId)?.faction?.topEntries ?? [];
      const scoreA = entriesA.length > 0 ? entriesA[entriesA.length - 1].points : Infinity;
      const scoreB = entriesB.length > 0 ? entriesB[entriesB.length - 1].points : Infinity;
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

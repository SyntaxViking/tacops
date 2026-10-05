import { useEffect, useState } from "react";
import { PlanetTrackerGraph } from "./PlanetTrackerGraph";
import { sortDominationPlanets } from "../crusade/crusade-domination-view-model";
import { liveSnapshotSample, trackedStateFromHistory, type TrackedPlanetSample } from "../crusade/planet-tracker-view-model";
import type { CrusadeData, PlanetLeaderboard, PlanetRefreshEntry } from "../api/types";

interface MonitorTabProps {
  crusadeData: CrusadeData | null;
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  favoritedPlanetIds: ReadonlySet<string>;
  error: string | null;
  // Fetched and kept fresh by App.tsx (not by this component) so it survives switching away from
  // the Monitor tab and back - this tab is only ever mounted while active (see App.tsx's
  // activeTab === "monitor" check), so state owned in here would reset to empty and have to
  // re-fetch from scratch on every single tab switch.
  historyByPlanet: Map<string, TrackedPlanetSample[]>;
}

// How often the "Ns elapsed" captions tick while this tab is open - coarser than the single live-
// tracked-planet graph's 1s tick (CrusadeTab) since this tab can render every planet in the crusade
// at once, and nothing here is being live-polled anyway (the underlying history only changes once
// every 5 minutes, on the backend poller's own cadence - see App.tsx's history-fetch effect).
const CAPTION_TICK_MS = 5_000;

// Shows every Domination planet's Combined (Imperial + Devastation on one shared scale) graph at
// once, in the same order the Crusade tab lists them - built purely from the backend's persisted
// per-planet history (see worker/planet-history.ts), not from any live polling of its own. A
// planet with no history recorded yet still gets a (momentarily empty) card rather than being
// skipped, so the set of cards shown doesn't shift around as data arrives.
export function MonitorTab({ crusadeData, planetRefreshState, favoritedPlanetIds, error, historyByPlanet }: MonitorTabProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), CAPTION_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  if (!crusadeData) {
    return error ? (
      <pre className="mt-4 w-full overflow-x-auto whitespace-pre-wrap rounded border border-red-400 bg-red-50 p-3 text-left text-sm text-red-700 dark:border-red-600 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </pre>
    ) : (
      <p>No crusade data loaded.</p>
    );
  }

  if (crusadeData.phase !== "STRUGGLE") {
    return <p>Monitor is only available during the Domination phase.</p>;
  }

  // Leaderboard-only view, same construction as CrusadeTab's own - feeds sortDominationPlanets
  // below so this tab's ordering matches the Crusade tab's default Domination order exactly.
  const leaderboardByPlanet = new Map<string, PlanetLeaderboard>();
  for (const [planetId, entry] of planetRefreshState) {
    if (entry.leaderboard) leaderboardByPlanet.set(planetId, entry.leaderboard);
  }

  // Same default ordering as the Crusade tab's own Domination list - deliberately the fixed
  // "closestToCapture" default rather than whatever sort mode/filters the user has live in the
  // Crusade tab right now, since this tab is mounted independently of that one's local state.
  const dominationPlanets = sortDominationPlanets(
    crusadeData.planets.filter((p) => planetRefreshState.has(p.planetId)),
    leaderboardByPlanet,
    favoritedPlanetIds,
    "closestToCapture",
  );

  if (dominationPlanets.length === 0) {
    return <p>No planet data loaded yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-4">
      {dominationPlanets.map((planet) => {
        const history = historyByPlanet.get(planet.planetId) ?? [];
        // No persisted history yet (just recontested, or the poller simply hasn't caught up) -
        // fall back to a single live "right now" point so the card shows something immediately
        // rather than sitting empty until the next poller tick.
        const fallback = liveSnapshotSample(planet, nowMs);
        const samples = history.length > 0 || !fallback ? history : [fallback];
        return (
          <PlanetTrackerGraph
            key={planet.planetId}
            state={trackedStateFromHistory(planet.planetId, samples, nowMs)}
            planetName={planet.name}
            nowMs={nowMs}
            onlyCombined
          />
        );
      })}
    </div>
  );
}

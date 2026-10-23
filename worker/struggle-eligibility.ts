// Which planets worker/poller.ts's STRUGGLE-phase leaderboard poll should ever visit: not every
// planet (unlike the broader history-write coverage in worker/planet-history.ts), only genuine
// "frontier" planets - not currently locked out by the post-capture cooldown, and adjacent to at
// least one planet owned by the opposite side. The adjacency graph comes from the static
// per-season sector-map.json asset (src/assets/seasons' getSectorMapData) rather than a live
// fetch - GET_CRUSADE itself carries no adjacency data, and this map layout is fixed for the
// whole season.
import { cooldownRemainingMs } from "../src/crusade/crusade-domination-view-model";
import type { CrusadeConnection, CrusadePlanet, CrusadeSectorMap } from "../src/api/types";

export function buildAdjacency(connections: readonly CrusadeConnection[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const { planet1, planet2 } of connections) {
    if (!adjacency.has(planet1)) adjacency.set(planet1, new Set());
    if (!adjacency.has(planet2)) adjacency.set(planet2, new Set());
    adjacency.get(planet1)!.add(planet2);
    adjacency.get(planet2)!.add(planet1);
  }
  return adjacency;
}

function sideOf(planet: CrusadePlanet | undefined): string | undefined {
  return planet?.sideOwner?.toLowerCase();
}

// True iff at least one neighbor is actually owned (a neutral/unowned neighbor has no side to
// attack from) by a side different from this planet's own - a neutral planet's own side is
// undefined, so any owned neighbor at all counts as "opposite" for it.
function hasOppositeSideNeighbor(planet: CrusadePlanet, neighborIds: Set<string> | undefined, planetsById: Map<string, CrusadePlanet>): boolean {
  if (!neighborIds) return false;
  const ownSide = sideOf(planet);
  for (const neighborId of neighborIds) {
    const neighborSide = sideOf(planetsById.get(neighborId));
    if (neighborSide && neighborSide !== ownSide) return true;
  }
  return false;
}

// cooldownRemainingMs (not isInDominationCooldown/isDominationSunk - see
// crusade-domination-view-model.ts) is the literal post-capture recaptureTimestamp lockout, not
// the broader "idle, 0/0, not yet (re)contested" state - that broader state is exactly the kind
// of frontier planet worth polling regularly, to catch the moment someone starts attacking it.
// "NotPlayable" sector-map nodes (scenery, not real Domination targets) are excluded the same way
// src/crusade/crusade-sector-map-view-model.ts already excludes them from its own map/connections.
export function eligibleStrugglePlanetIds(planets: readonly CrusadePlanet[], sectorMap: CrusadeSectorMap, nowMs: number): string[] {
  const playableIds = new Set(sectorMap.planets.filter((p) => p.type !== "NotPlayable").map((p) => p.planetId));
  const adjacency = buildAdjacency(sectorMap.connections);
  const planetsById = new Map(planets.map((p) => [p.planetId, p]));

  return planets
    .filter((planet) => playableIds.has(planet.planetId))
    .filter((planet) => cooldownRemainingMs(planet, nowMs) === null)
    .filter((planet) => hasOppositeSideNeighbor(planet, adjacency.get(planet.planetId), planetsById))
    .map((planet) => planet.planetId);
}

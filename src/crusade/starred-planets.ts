// Starred planets keep auto-refreshing (see isPlanetAutoRefreshable), so the number a user can star is
// capped to bound how much background polling one account generates.
export const MAX_STARRED_PLANETS = 10;

// For a saved list that may predate the cap (or come from anywhere): keeps the first
// MAX_STARRED_PLANETS in stored order and silently drops the rest.
export function capStarredPlanets(planetIds: readonly string[]): string[] {
  return planetIds.slice(0, MAX_STARRED_PLANETS);
}

// Only a star on a planet that's actually in planetRefreshState can cost anything in background
// polling - isPlanetAutoRefreshable's caller only ever iterates planetRefreshState's own keys
// (App.tsx), and that map is reseeded per fetch to exactly the current Expansion zone's planets
// (or every planet during Domination) - see activePlanetIds in crusade-data-mapping.ts. A star left
// over from a since-rotated-out Expansion zone already isn't being refreshed, so it shouldn't count
// against the cap either; otherwise a handful of old stars can permanently block starring anything
// in the current zone even though they cost nothing today. `relevantPlanetIds: null` counts every
// starred planet regardless (the pre-existing behavior) - used where no such scoping is available.
function countStarredTowardCap(starred: ReadonlySet<string>, relevantPlanetIds: ReadonlySet<string> | null): number {
  if (relevantPlanetIds === null) return starred.size;
  let count = 0;
  for (const planetId of starred) {
    if (relevantPlanetIds.has(planetId)) count++;
  }
  return count;
}

// The star button is disabled (not hidden) for an unstarred planet once the cap is reached;
// starred planets always stay clickable so they can be un-starred, which re-enables the rest.
export function isStarDisabled(
  starred: ReadonlySet<string>,
  planetId: string,
  relevantPlanetIds: ReadonlySet<string> | null = null,
): boolean {
  return !starred.has(planetId) && countStarredTowardCap(starred, relevantPlanetIds) >= MAX_STARRED_PLANETS;
}

// Un-starring always works; starring is silently ignored once the cap is reached, returning the
// same Set instance so the caller can tell nothing changed and skip saving/notifying.
export function toggleStarredPlanet(
  current: ReadonlySet<string>,
  planetId: string,
  relevantPlanetIds: ReadonlySet<string> | null = null,
): ReadonlySet<string> {
  if (current.has(planetId)) {
    const next = new Set(current);
    next.delete(planetId);
    return next;
  }
  if (countStarredTowardCap(current, relevantPlanetIds) >= MAX_STARRED_PLANETS) return current;
  return new Set(current).add(planetId);
}

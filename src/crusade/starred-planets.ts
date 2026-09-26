// Starred planets keep auto-refreshing (see isPlanetAutoRefreshable), so the number a user can star is
// capped to bound how much background polling one account generates.
export const MAX_STARRED_PLANETS = 10;

// For a saved list that may predate the cap (or come from anywhere): keeps the first
// MAX_STARRED_PLANETS in stored order and silently drops the rest.
export function capStarredPlanets(planetIds: readonly string[]): string[] {
  return planetIds.slice(0, MAX_STARRED_PLANETS);
}

// The star button is disabled (not hidden) for an unstarred planet once the cap is reached;
// starred planets always stay clickable so they can be un-starred, which re-enables the rest.
export function isStarDisabled(starred: ReadonlySet<string>, planetId: string): boolean {
  return !starred.has(planetId) && starred.size >= MAX_STARRED_PLANETS;
}

// Un-starring always works; starring is silently ignored once the cap is reached, returning the
// same Set instance so the caller can tell nothing changed and skip saving/notifying.
export function toggleStarredPlanet(current: ReadonlySet<string>, planetId: string): ReadonlySet<string> {
  if (current.has(planetId)) {
    const next = new Set(current);
    next.delete(planetId);
    return next;
  }
  if (current.size >= MAX_STARRED_PLANETS) return current;
  return new Set(current).add(planetId);
}

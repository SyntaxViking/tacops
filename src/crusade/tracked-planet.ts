import type { CrusadePlanet } from "../api/types";
import { isDominationSunk, pointsRemaining } from "./crusade-domination-view-model";

// "Available to track" per the tracker feature's spec: real struggle data, both sides still have
// points left to capture (a side already at 0 remaining is about to flip, if it hasn't already),
// and not already sunk (captured or in post-capture cooldown - see isDominationSunk).
export function isPlanetTrackable(planet: CrusadePlanet): boolean {
  if (!planet.struggleData) return false;
  if (isDominationSunk(planet)) return false;
  const remaining = pointsRemaining(planet);
  return remaining.imperial > 0 && remaining.devastation > 0;
}

// Only one planet can be tracked at a time - every other planet's track button is disabled while
// one is active, re-enabled the instant it's untracked.
export function isTrackDisabled(trackedPlanetId: string | null, planetId: string): boolean {
  return trackedPlanetId !== null && trackedPlanetId !== planetId;
}

// Pure toggle: tracking the already-tracked planet untracks it (null); tracking a different one
// only ever reaches here when nothing else is tracked, since isTrackDisabled keeps every other
// button disabled otherwise.
export function toggleTrackedPlanetId(current: string | null, planetId: string): string | null {
  return current === planetId ? null : planetId;
}

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

// A track button is disabled only when this planet isn't the currently-tracked one AND isn't
// independently trackable - the currently-tracked planet's own button always stays enabled (so it
// can be untracked even after it's since become sunk/frozen), and any other live, contestable
// planet's button stays enabled too. Clicking a different, trackable planet's button switches
// tracking straight to it (untracking the old one and tracking the new one in one action) rather
// than requiring an untrack-first step - only one planet can ever be tracked at a time, but
// switching which one no longer needs two clicks.
export function isTrackDisabled(trackedPlanetId: string | null, planet: CrusadePlanet): boolean {
  return trackedPlanetId !== planet.planetId && !isPlanetTrackable(planet);
}

// Pure toggle: tracking the already-tracked planet untracks it (null); tracking any other planet
// switches straight to it, discarding whatever was tracked before - the UI (see isTrackDisabled)
// only ever allows this for a planet that's itself trackable.
export function toggleTrackedPlanetId(current: string | null, planetId: string): string | null {
  return current === planetId ? null : planetId;
}

import type { CrusadePlanet, PlanetLeaderboard } from "../api/types";

export interface ConquestProgress {
  imperialCurrent: number;
  imperialThreshold: number;
  imperialPercent: number;
  devastationCurrent: number;
  devastationThreshold: number;
  devastationPercent: number;
}

function percentOf(current: number, threshold: number): number {
  return threshold > 0 ? Math.round((current / threshold) * 100) : 0;
}

// The planet's owner (sideOwner) is defending it - their points are measured against the
// Defender threshold, while the other side is attacking, measured against the Attacker threshold.
export function computeConquestProgress(planet: CrusadePlanet): ConquestProgress | null {
  if (!planet.struggleData) return null;
  const { conquestThresholdPointsAttacker, conquestThresholdPointsDefender } = planet.struggleData;
  const imperialOwns = planet.sideOwner?.toLowerCase() === "for";
  const imperialThreshold = imperialOwns ? conquestThresholdPointsDefender : conquestThresholdPointsAttacker;
  const devastationThreshold = imperialOwns ? conquestThresholdPointsAttacker : conquestThresholdPointsDefender;
  const imperialCurrent = planet.pointsFor ?? 0;
  const devastationCurrent = planet.pointsAgainst ?? 0;
  return {
    imperialCurrent,
    imperialThreshold,
    imperialPercent: percentOf(imperialCurrent, imperialThreshold),
    devastationCurrent,
    devastationThreshold,
    devastationPercent: percentOf(devastationCurrent, devastationThreshold),
  };
}

export function isPlanetRanked(leaderboard: PlanetLeaderboard | undefined): boolean {
  return leaderboard?.side?.myRank != null || leaderboard?.faction?.myRank != null;
}

export interface CaptureRace {
  leadingSide: "Imperial" | "Devastation";
  pointsRemaining: number;
}

// Whichever side is closer to hitting its own conquest threshold - a low pointsRemaining means the
// planet is about to flip, which is exactly the kind of planet worth piling points onto.
export function computeCaptureRace(planet: CrusadePlanet): CaptureRace | null {
  const progress = computeConquestProgress(planet);
  if (!progress) return null;
  const imperialRemaining = progress.imperialThreshold - progress.imperialCurrent;
  const devastationRemaining = progress.devastationThreshold - progress.devastationCurrent;
  return imperialRemaining <= devastationRemaining
    ? { leadingSide: "Imperial", pointsRemaining: imperialRemaining }
    : { leadingSide: "Devastation", pointsRemaining: devastationRemaining };
}

function factionParticipants(leaderboard: PlanetLeaderboard | undefined): number {
  return leaderboard?.faction?.numParticipants ?? Infinity;
}

export type DominationSortMode = "closestToCapture" | "imperialFirst" | "devastationFirst";

// A negative pointsRemaining means a side has already crossed its conquest threshold - the planet
// was just captured and hasn't dropped out of the active list yet, so it's no longer a live
// opportunity worth surfacing near the top.
function isJustCaptured(planet: CrusadePlanet): boolean {
  const race = computeCaptureRace(planet);
  return race !== null && race.pointsRemaining < 0;
}

function pointsRemaining(planet: CrusadePlanet): { imperial: number; devastation: number } {
  const progress = computeConquestProgress(planet);
  if (!progress) return { imperial: Infinity, devastation: Infinity };
  return {
    imperial: progress.imperialThreshold - progress.imperialCurrent,
    devastation: progress.devastationThreshold - progress.devastationCurrent,
  };
}

// Both sides Infinity (no struggleData at all) means Infinity - Infinity (NaN), not a tie of 0 -
// guard explicitly rather than relying on subtraction.
function safeDiff(a: number, b: number): number {
  return a === b ? 0 : a - b;
}

function compareBySortMode(mode: DominationSortMode, a: CrusadePlanet, b: CrusadePlanet): number {
  const remA = pointsRemaining(a);
  const remB = pointsRemaining(b);
  switch (mode) {
    case "closestToCapture":
      return safeDiff(Math.min(remA.imperial, remA.devastation), Math.min(remB.imperial, remB.devastation));
    case "imperialFirst":
      return safeDiff(remA.imperial, remB.imperial) || safeDiff(remA.devastation, remB.devastation);
    case "devastationFirst":
      return safeDiff(remA.devastation, remB.devastation) || safeDiff(remA.imperial, remB.imperial);
  }
}

// Three-bucket partition shared by both Crusade phases: planets a side has already captured (see
// isJustCaptured) always sink to the very bottom, checked before rank so a just-flipped planet
// never gets to hide in the ranked group; then planets where the player has a faction rank (which
// always implies a side rank too, for the same planet) come next; everything else follows. Each
// bucket is ordered by the caller's compare, so "ranked first" doesn't disturb whatever ordering
// is currently selected.
export function sortPlanetsRankedFirst(
  planets: CrusadePlanet[],
  leaderboardByPlanet: Map<string, PlanetLeaderboard>,
  compare: (a: CrusadePlanet, b: CrusadePlanet) => number,
): CrusadePlanet[] {
  const ranked: CrusadePlanet[] = [];
  const unranked: CrusadePlanet[] = [];
  const justCaptured: CrusadePlanet[] = [];
  for (const planet of planets) {
    if (isJustCaptured(planet)) {
      justCaptured.push(planet);
    } else if (leaderboardByPlanet.get(planet.planetId)?.faction?.myRank != null) {
      ranked.push(planet);
    } else {
      unranked.push(planet);
    }
  }

  ranked.sort(compare);
  unranked.sort(compare);
  justCaptured.sort(compare);

  return [...ranked, ...unranked, ...justCaptured];
}

export function sortDominationPlanets(
  planets: CrusadePlanet[],
  leaderboardByPlanet: Map<string, PlanetLeaderboard>,
  sortMode: DominationSortMode = "closestToCapture",
): CrusadePlanet[] {
  return sortPlanetsRankedFirst(planets, leaderboardByPlanet, (a, b) => {
    const cmp = compareBySortMode(sortMode, a, b);
    if (cmp !== 0) return cmp;
    return factionParticipants(leaderboardByPlanet.get(a.planetId)) - factionParticipants(leaderboardByPlanet.get(b.planetId));
  });
}

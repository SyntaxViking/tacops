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

// Struggle-gated so an Expansion planet (never has struggleData, and can legitimately show 0/0
// before its first leaderboard fetch) never gets swept into this - only real Domination cooldown
// (post-capture lockout, or simply not fought over yet this stage) counts.
function isInDominationCooldown(planet: CrusadePlanet): boolean {
  return planet.struggleData != null && (planet.pointsFor ?? 0) === 0 && (planet.pointsAgainst ?? 0) === 0;
}

function isDominationSunk(planet: CrusadePlanet): boolean {
  return isJustCaptured(planet) || isInDominationCooldown(planet);
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

// Five-bucket partition shared by both Crusade phases, in priority order: live starred planets
// come first (outranks being ranked - a planet the player deliberately flagged is a stronger
// signal than an incidental leaderboard rank); then starred planets that are sunk (caller's isSunk
// - e.g. Domination's already-captured-or-cooldown check) - a star keeps a planet near the top even
// once it's no longer a live opportunity, it just falls behind other active stars; then ranked
// (a faction rank always implies a side rank too, for the same planet); then unranked; non-starred
// sunk planets go last. Each bucket is ordered by the caller's compare, so none of this grouping
// disturbs whatever sort is currently selected.
export function sortPlanetsRankedFirst(
  planets: CrusadePlanet[],
  leaderboardByPlanet: Map<string, PlanetLeaderboard>,
  starredPlanetIds: ReadonlySet<string>,
  compare: (a: CrusadePlanet, b: CrusadePlanet) => number,
  isSunk: (planet: CrusadePlanet) => boolean = () => false,
): CrusadePlanet[] {
  const starred: CrusadePlanet[] = [];
  const starredSunk: CrusadePlanet[] = [];
  const ranked: CrusadePlanet[] = [];
  const unranked: CrusadePlanet[] = [];
  const sunk: CrusadePlanet[] = [];
  for (const planet of planets) {
    if (starredPlanetIds.has(planet.planetId)) {
      (isSunk(planet) ? starredSunk : starred).push(planet);
    } else if (isSunk(planet)) {
      sunk.push(planet);
    } else if (leaderboardByPlanet.get(planet.planetId)?.faction?.myRank != null) {
      ranked.push(planet);
    } else {
      unranked.push(planet);
    }
  }

  starred.sort(compare);
  starredSunk.sort(compare);
  ranked.sort(compare);
  unranked.sort(compare);
  sunk.sort(compare);

  return [...starred, ...starredSunk, ...ranked, ...unranked, ...sunk];
}

// The rank each filter checks - side against the #25 row, faction against the #10 row (both are
// among BENCHMARK_RANKS in fetch-crusade-data.ts, so they're always computed when present).
const SIDE_FILTER_RANK = 25;
const FACTION_FILTER_RANK = 10;

// Fewer participants than the target rank means there's no real row at that rank to worry about -
// treated as 0 points (per the caller's spec) so a filter threshold, which is always a positive
// integer, never hides a planet on that basis alone.
function pointsAtRank(result: PlanetLeaderboard["side"] | PlanetLeaderboard["faction"] | undefined, rank: number): number {
  if (!result || result.numParticipants < rank) return 0;
  return result.benchmarks.find((b) => b.rank === rank)?.points ?? 0;
}

// Empty or non-positive-integer input means "no filter" - only an actual positive integer
// activates the corresponding threshold.
export function parsePositiveIntFilter(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A planet fails (is hidden) when its relevant leaderboard's target rank (see SIDE_FILTER_RANK/
// FACTION_FILTER_RANK) already needs more points than the user's threshold - i.e. cracking that
// rank is already out of reach. A planet with no leaderboard data loaded yet always passes (same
// as pointsAtRank treating "no row at that rank" as 0) - a filter should never hide a planet just
// because its data hasn't arrived, only once it positively demonstrates the threshold is exceeded.
export function passesDominationFilters(leaderboard: PlanetLeaderboard | undefined, maxSide: number | null, maxFaction: number | null): boolean {
  if (maxSide !== null && pointsAtRank(leaderboard?.side, SIDE_FILTER_RANK) > maxSide) return false;
  if (maxFaction !== null && pointsAtRank(leaderboard?.faction, FACTION_FILTER_RANK) > maxFaction) return false;
  return true;
}

export function sortDominationPlanets(
  planets: CrusadePlanet[],
  leaderboardByPlanet: Map<string, PlanetLeaderboard>,
  starredPlanetIds: ReadonlySet<string>,
  sortMode: DominationSortMode = "closestToCapture",
): CrusadePlanet[] {
  return sortPlanetsRankedFirst(
    planets,
    leaderboardByPlanet,
    starredPlanetIds,
    (a, b) => {
      const cmp = compareBySortMode(sortMode, a, b);
      if (cmp !== 0) return cmp;
      return factionParticipants(leaderboardByPlanet.get(a.planetId)) - factionParticipants(leaderboardByPlanet.get(b.planetId));
    },
    isDominationSunk,
  );
}

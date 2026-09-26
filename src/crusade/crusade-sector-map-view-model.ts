import { computeConquestProgress, type ConquestProgress } from "./crusade-domination-view-model";
import type { CrusadePlanet, CrusadeSectorMap } from "../api/types";

export type SectorMapColor = "imperial" | "devastation" | "neutral";

export interface SectorMapNode {
  planetId: string;
  name: string;
  type: string;
  x: number; // normalized [0,1] within this sector's own bounding box
  y: number;
  color: SectorMapColor;
  // null when the planet has no struggle data (or isn't in the crusade data at all) - no bars drawn.
  progress: ConquestProgress | null;
  // How big to draw the dot, from 0 (smallest - the highest capture requirement on the whole map)
  // to 1 (largest - the lowest). null = no requirement known, so it keeps the full-size dot.
  dotScale: number | null;
}

export interface SectorMapEdge {
  from: SectorMapNode;
  to: SectorMapNode;
}

export interface SectorMapData {
  zone: number;
  // Width relative to the height (1 for a single sector's own square-ish layout); x coordinates
  // run [0, aspect] while y runs [0, 1].
  aspect: number;
  nodes: SectorMapNode[];
  edges: SectorMapEdge[];
  // Where to caption each sector (its center x) and where one sector ends and the next begins
  // (the x midway through the gap) - only set on the all-sectors map.
  sectorLabels: { zone: number; x: number }[];
  sectorBoundaries: number[];
}

function normalize(value: number, min: number, max: number): number {
  return max > min ? (value - min) / (max - min) : 0.5;
}

function colorFor(sideOwner: string | undefined): SectorMapColor {
  if (sideOwner?.toLowerCase() === "for") return "imperial";
  if (sideOwner?.toLowerCase() === "against") return "devastation";
  return "neutral";
}

// A planet's capture requirement is the larger of the two sides' thresholds.
export function captureRequirement(progress: ConquestProgress): number {
  return Math.max(progress.imperialThreshold, progress.devastationThreshold);
}

// Dot scale by the *inverse rank* of each planet's capture requirement: the highest requirement
// gets 0 (drawn smallest), the lowest gets 1 (largest), and the ranks in between are spaced evenly
// - by rank, not by value, so one outlier requirement can't squash everyone else's dot to the same
// size. Planets tied on a requirement share a rank (and so a size). With only one distinct
// requirement there's nothing to rank, so everyone stays full size.
export function computeDotScales(requirements: ReadonlyMap<string, number>): Map<string, number> {
  const distinctDescending = [...new Set(requirements.values())].sort((a, b) => b - a);
  const scales = new Map<string, number>();
  for (const [planetId, requirement] of requirements) {
    const rank = distinctDescending.indexOf(requirement); // 0 = highest requirement
    scales.set(planetId, distinctDescending.length > 1 ? rank / (distinctDescending.length - 1) : 1);
  }
  return scales;
}

// Dot radius in the map's viewBox units (100 wide, drawn ~860px at the modal's widest, so ~8.6px per
// unit): the smallest dot is about 1px, the largest is the original fixed size.
export const MIN_DOT_RADIUS = 0.12;
export const MAX_DOT_RADIUS = 2;

export function dotRadius(dotScale: number | null): number {
  return dotScale === null ? MAX_DOT_RADIUS : MIN_DOT_RADIUS + (MAX_DOT_RADIUS - MIN_DOT_RADIUS) * dotScale;
}

export interface PlanetProgressBars {
  imperial: number; // fraction of the way to its own capture threshold, in [0, 1)
  devastation: number;
}

// The two progress bars drawn above a planet on the sector map. Omitted (null) when there's nothing
// meaningful to show: either side has reached its threshold (the planet is captured - BOTH bars go,
// not just the winner's), or neither side has scored yet (0 points each - a planet nobody has
// touched, or one still in its post-capture lockout). A zero threshold counts as reached, which
// also avoids dividing by it.
export function planetProgressBars(progress: ConquestProgress | null): PlanetProgressBars | null {
  if (!progress) return null;
  const { imperialCurrent, imperialThreshold, devastationCurrent, devastationThreshold } = progress;
  if (imperialCurrent >= imperialThreshold || devastationCurrent >= devastationThreshold) return null;
  if (imperialCurrent <= 0 && devastationCurrent <= 0) return null;
  return {
    imperial: Math.max(0, imperialCurrent) / imperialThreshold,
    devastation: Math.max(0, devastationCurrent) / devastationThreshold,
  };
}

// Every playable planet in the crusade, ranked by capture requirement (see computeDotScales).
// Ranked across the whole crusade, not just one sector, so a planet's dot stays the same size as
// you step between sectors or expand to all of them.
function crusadeDotScales(sectorMap: CrusadeSectorMap, crusadePlanetById: Map<string, CrusadePlanet>): Map<string, number> {
  const requirements = new Map<string, number>();
  for (const p of sectorMap.planets) {
    if (p.type === "NotPlayable") continue;
    const crusadePlanet = crusadePlanetById.get(p.planetId);
    const progress = crusadePlanet ? computeConquestProgress(crusadePlanet) : null;
    if (progress) requirements.set(p.planetId, captureRequirement(progress));
  }
  return computeDotScales(requirements);
}

// Lays out `planets` (all playable) as nodes and every connection with both ends among them.
// `place` turns a planet's raw game position into the node's x/y.
function buildMap(
  zone: number,
  aspect: number,
  planets: CrusadeSectorMap["planets"],
  sectorMap: CrusadeSectorMap,
  crusadePlanets: CrusadePlanet[],
  place: (p: CrusadeSectorMap["planets"][number]) => { x: number; y: number },
): SectorMapData {
  const crusadePlanetById = new Map(crusadePlanets.map((p) => [p.planetId, p]));
  const dotScales = crusadeDotScales(sectorMap, crusadePlanetById);

  const nodeById = new Map<string, SectorMapNode>();
  for (const p of planets) {
    const crusadePlanet = crusadePlanetById.get(p.planetId);
    nodeById.set(p.planetId, {
      planetId: p.planetId,
      name: crusadePlanet?.name ?? p.planetId,
      type: p.type,
      ...place(p),
      color: colorFor(crusadePlanet?.sideOwner),
      progress: crusadePlanet ? computeConquestProgress(crusadePlanet) : null,
      dotScale: dotScales.get(p.planetId) ?? null,
    });
  }

  const edges: SectorMapEdge[] = [];
  for (const c of sectorMap.connections) {
    const from = nodeById.get(c.planet1);
    const to = nodeById.get(c.planet2);
    if (from && to) edges.push({ from, to });
  }

  return { zone, aspect, nodes: [...nodeById.values()], edges, sectorLabels: [], sectorBoundaries: [] };
}

export function computeSectorMap(zone: number, sectorMap: CrusadeSectorMap, crusadePlanets: CrusadePlanet[]): SectorMapData {
  // "NotPlayable" planets are map scenery, not capturable - omitted entirely (dot, name, and any
  // connection to them). Filtered before the bounding box below, so they don't stretch the layout
  // of the planets that are actually shown.
  const zonePlanets = sectorMap.planets.filter((p) => p.zone === zone && p.type !== "NotPlayable");
  const minX = Math.min(...zonePlanets.map((p) => p.positionX));
  const maxX = Math.max(...zonePlanets.map((p) => p.positionX));
  const minY = Math.min(...zonePlanets.map((p) => p.positionY));
  const maxY = Math.max(...zonePlanets.map((p) => p.positionY));

  // Connections crossing sector boundaries have nowhere to draw their other end on a single
  // sector's map, so they're dropped rather than half-drawn (see computeAllSectorsMap for those).
  return buildMap(zone, 1, zonePlanets, sectorMap, crusadePlanets, (p) => ({
    x: normalize(p.positionX, minX, maxX),
    // Inverted: the game's positionY increases upward, but SVG y increases downward - without
    // this, the rendered sector map is upside down relative to the in-game map.
    y: 1 - normalize(p.positionY, minY, maxY),
  }));
}

// All sectors in one continuous map. The game's own coordinates already lay the sectors out left
// to right, so drawing them in one shared coordinate space (rather than one map per sector) is
// what lets connections between neighboring sectors be drawn. One scale for both axes - x is
// [0, aspect], y is [0, 1] - so each sector keeps the same proportions as on its own map.
export function computeAllSectorsMap(sectorMap: CrusadeSectorMap, crusadePlanets: CrusadePlanet[]): SectorMapData {
  const planets = sectorMap.planets.filter((p) => p.type !== "NotPlayable");
  const minX = Math.min(...planets.map((p) => p.positionX));
  const maxX = Math.max(...planets.map((p) => p.positionX));
  const minY = Math.min(...planets.map((p) => p.positionY));
  const maxY = Math.max(...planets.map((p) => p.positionY));
  const height = maxY > minY ? maxY - minY : 1;

  const map = buildMap(-1, (maxX - minX) / height, planets, sectorMap, crusadePlanets, (p) => ({
    x: (p.positionX - minX) / height,
    y: 1 - (p.positionY - minY) / height,
  }));

  const zoneById = new Map(planets.map((p) => [p.planetId, p.zone]));
  const extents = sectorZones(sectorMap).map((zone) => {
    const xs = map.nodes.filter((n) => zoneById.get(n.planetId) === zone).map((n) => n.x);
    return { zone, min: Math.min(...xs), max: Math.max(...xs) };
  });
  map.sectorLabels = extents.map((e) => ({ zone: e.zone, x: (e.min + e.max) / 2 }));
  map.sectorBoundaries = extents.slice(1).map((e, i) => (extents[i].max + e.min) / 2);
  return map;
}

// The sectors (0-based zones) that actually have something to draw, in order - what the modal's
// previous/next arrows step through. NotPlayable planets don't count, same as on the map itself.
export function sectorZones(sectorMap: CrusadeSectorMap): number[] {
  const zones = new Set<number>();
  for (const p of sectorMap.planets) {
    if (p.type !== "NotPlayable") zones.add(p.zone);
  }
  return [...zones].sort((a, b) => a - b);
}

// Next (+1) or previous (-1) sector, wrapping around at the ends so the arrows always do
// something. Stays put if there's nothing to step to (fewer than two sectors, or the current zone
// isn't one of them).
export function adjacentZone(zones: readonly number[], current: number, direction: -1 | 1): number {
  const index = zones.indexOf(current);
  if (index === -1 || zones.length < 2) return current;
  return zones[(index + direction + zones.length) % zones.length];
}

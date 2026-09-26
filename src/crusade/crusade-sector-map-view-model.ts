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
}

export interface SectorMapEdge {
  from: SectorMapNode;
  to: SectorMapNode;
}

export interface SectorMapData {
  zone: number;
  nodes: SectorMapNode[];
  edges: SectorMapEdge[];
}

function normalize(value: number, min: number, max: number): number {
  return max > min ? (value - min) / (max - min) : 0.5;
}

function colorFor(sideOwner: string | undefined): SectorMapColor {
  if (sideOwner?.toLowerCase() === "for") return "imperial";
  if (sideOwner?.toLowerCase() === "against") return "devastation";
  return "neutral";
}

export interface PlanetProgressBars {
  imperial: number; // fraction of the way to its own capture threshold, in [0, 1)
  devastation: number;
}

// The two progress bars drawn above a planet on the sector map. A planet where either side has
// reached its threshold is captured - there's no progress left to show, so BOTH bars are omitted
// (null), not just the winner's. A zero threshold counts as reached, which also avoids dividing by
// it.
export function planetProgressBars(progress: ConquestProgress | null): PlanetProgressBars | null {
  if (!progress) return null;
  const { imperialCurrent, imperialThreshold, devastationCurrent, devastationThreshold } = progress;
  if (imperialCurrent >= imperialThreshold || devastationCurrent >= devastationThreshold) return null;
  return {
    imperial: Math.max(0, imperialCurrent) / imperialThreshold,
    devastation: Math.max(0, devastationCurrent) / devastationThreshold,
  };
}

export function computeSectorMap(zone: number, sectorMap: CrusadeSectorMap, crusadePlanets: CrusadePlanet[]): SectorMapData {
  const crusadePlanetById = new Map(crusadePlanets.map((p) => [p.planetId, p]));
  const zonePlanets = sectorMap.planets.filter((p) => p.zone === zone);

  const xs = zonePlanets.map((p) => p.positionX);
  const ys = zonePlanets.map((p) => p.positionY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const nodeById = new Map<string, SectorMapNode>();
  for (const p of zonePlanets) {
    const crusadePlanet = crusadePlanetById.get(p.planetId);
    nodeById.set(p.planetId, {
      planetId: p.planetId,
      name: crusadePlanet?.name ?? p.planetId,
      type: p.type,
      x: normalize(p.positionX, minX, maxX),
      // Inverted: the game's positionY increases upward, but SVG y increases downward - without
      // this, the rendered sector map is upside down relative to the in-game map.
      y: 1 - normalize(p.positionY, minY, maxY),
      color: colorFor(crusadePlanet?.sideOwner),
      progress: crusadePlanet ? computeConquestProgress(crusadePlanet) : null,
    });
  }

  const edges: SectorMapEdge[] = [];
  for (const c of sectorMap.connections) {
    const from = nodeById.get(c.planet1);
    const to = nodeById.get(c.planet2);
    // Both ends must be in this zone - connections crossing sector boundaries have nowhere to
    // draw their other end on a single sector's map, so they're dropped rather than half-drawn.
    if (from && to) edges.push({ from, to });
  }

  return { zone, nodes: [...nodeById.values()], edges };
}

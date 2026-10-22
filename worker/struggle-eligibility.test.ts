import { describe, expect, it } from "vitest";
import { buildAdjacency, eligibleStrugglePlanetIds } from "./struggle-eligibility";
import type { CrusadePlanet, CrusadeSectorMap } from "../src/api/types";

describe("buildAdjacency", () => {
  it("builds an undirected adjacency map from a connection list", () => {
    const adjacency = buildAdjacency([
      { planet1: "a", planet2: "b" },
      { planet1: "b", planet2: "c" },
    ]);
    expect(adjacency.get("a")).toEqual(new Set(["b"]));
    expect(adjacency.get("b")).toEqual(new Set(["a", "c"]));
    expect(adjacency.get("c")).toEqual(new Set(["b"]));
  });
});

// A simple line: planet_a - planet_b - planet_c - planet_d, plus a NotPlayable scenery node
// attached to planet_a (suns on the real map have no connections at all, but this also exercises
// the exclusion filter directly).
const sectorMap: CrusadeSectorMap = {
  planets: [
    { planetId: "planet_a", zone: 0, type: "Civilized", positionX: 0, positionY: 0 },
    { planetId: "planet_b", zone: 0, type: "Civilized", positionX: 1, positionY: 0 },
    { planetId: "planet_c", zone: 0, type: "Civilized", positionX: 2, positionY: 0 },
    { planetId: "planet_d", zone: 0, type: "Civilized", positionX: 3, positionY: 0 },
    { planetId: "scenery", zone: 0, type: "NotPlayable", positionX: 4, positionY: 0 },
  ],
  connections: [
    { planet1: "planet_a", planet2: "planet_b" },
    { planet1: "planet_b", planet2: "planet_c" },
    { planet1: "planet_c", planet2: "planet_d" },
    { planet1: "scenery", planet2: "planet_a" },
  ],
};

function planet(planetId: string, sideOwner: string | undefined, overrides: Partial<CrusadePlanet> = {}): CrusadePlanet {
  return { planetId, name: planetId, zone: 0, sideOwner, ...overrides };
}

const now = Date.now();

describe("eligibleStrugglePlanetIds", () => {
  it("excludes a planet with no connections at all", () => {
    const isolated: CrusadeSectorMap = { planets: [{ planetId: "lone", zone: 0, type: "Civilized", positionX: 0, positionY: 0 }], connections: [] };
    expect(eligibleStrugglePlanetIds([planet("lone", undefined)], isolated, now)).toEqual([]);
  });

  it("excludes a planet whose only neighbors are neutral or the same side as itself", () => {
    const planets = [planet("planet_a", undefined), planet("planet_b", "For"), planet("planet_c", "For"), planet("planet_d", "For")];
    // planet_b's neighbors are planet_a (neutral) and planet_c (also "For") - no opposite side.
    expect(eligibleStrugglePlanetIds(planets, sectorMap, now)).not.toContain("planet_b");
  });

  it("includes a planet adjacent to an opposite-side-owned planet", () => {
    const planets = [planet("planet_a", undefined), planet("planet_b", "For"), planet("planet_c", "For"), planet("planet_d", "Against")];
    // planet_c is "For", adjacent to planet_d which is "Against" - a real frontier planet.
    expect(eligibleStrugglePlanetIds(planets, sectorMap, now)).toContain("planet_c");
  });

  it("includes a neutral planet adjacent to any owned planet (no side of its own to compare against)", () => {
    const planets = [planet("planet_a", undefined), planet("planet_b", "For"), planet("planet_c", "For"), planet("planet_d", "For")];
    expect(eligibleStrugglePlanetIds(planets, sectorMap, now)).toContain("planet_a");
  });

  it("excludes a planet still inside its post-capture cooldown, even with an opposite-side neighbor", () => {
    const planets = [
      planet("planet_a", undefined),
      planet("planet_b", "For"),
      planet("planet_c", "For", { struggleData: { conquestThresholdPointsAttacker: 100, conquestThresholdPointsDefender: 100, recaptureTimestamp: now + 60_000 } }),
      planet("planet_d", "Against"),
    ];
    expect(eligibleStrugglePlanetIds(planets, sectorMap, now)).not.toContain("planet_c");
  });

  it("includes a planet that's idle/uncontested (0/0, no recaptureTimestamp) but has an opposite-side neighbor", () => {
    const planets = [
      planet("planet_a", undefined),
      planet("planet_b", "For"),
      planet("planet_c", "For", { pointsFor: 0, pointsAgainst: 0, struggleData: { conquestThresholdPointsAttacker: 100, conquestThresholdPointsDefender: 100 } }),
      planet("planet_d", "Against"),
    ];
    expect(eligibleStrugglePlanetIds(planets, sectorMap, now)).toContain("planet_c");
  });

  it("never includes a NotPlayable sector-map node, regardless of ownership data", () => {
    const planets = [planet("planet_a", "For"), planet("scenery", "Against")];
    expect(eligibleStrugglePlanetIds(planets, sectorMap, now)).not.toContain("scenery");
  });

  it("matches sideOwner case-insensitively (For/for, Against/against)", () => {
    const planets = [planet("planet_a", undefined), planet("planet_b", "for"), planet("planet_c", "FOR"), planet("planet_d", "Against")];
    expect(eligibleStrugglePlanetIds(planets, sectorMap, now)).toContain("planet_c");
  });
});

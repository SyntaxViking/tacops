import { describe, expect, it } from "vitest";
import {
  MAX_DOT_RADIUS,
  MIN_DOT_RADIUS,
  adjacentZone,
  captureRequirement,
  computeAllSectorsMap,
  computeDotScales,
  computeSectorMap,
  dotRadius,
  planetProgressBars,
  sectorZones,
} from "./crusade-sector-map-view-model";
import type { ConquestProgress } from "./crusade-domination-view-model";
import type { CrusadePlanet, CrusadeSectorMap } from "../api/types";

function crusadePlanet(overrides: Partial<CrusadePlanet> = {}): CrusadePlanet {
  return { planetId: "planet_001", name: "Test Planet", zone: 0, ...overrides };
}

describe("computeSectorMap", () => {
  it("normalizes positions to [0,1] within the sector's own bounding box", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [
        { planetId: "planet_001", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
        { planetId: "planet_002", zone: 0, type: "Civilized", positionX: 100, positionY: 50 },
      ],
      connections: [],
    };
    const result = computeSectorMap(0, sectorMap, [crusadePlanet({ planetId: "planet_001" }), crusadePlanet({ planetId: "planet_002" })]);

    const n1 = result.nodes.find((n) => n.planetId === "planet_001")!;
    const n2 = result.nodes.find((n) => n.planetId === "planet_002")!;
    // y is inverted relative to x (game positionY increases upward, SVG y increases downward) -
    // planet_001 has the lowest positionY but lands at the top of the rendered map (y: 0).
    expect(n1).toMatchObject({ x: 0, y: 1 });
    expect(n2).toMatchObject({ x: 1, y: 0 });
  });

  it("centers a single-planet axis at 0.5 instead of dividing by zero", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [{ planetId: "planet_001", zone: 0, type: "Fortress", positionX: 500, positionY: -200 }],
      connections: [],
    };
    const result = computeSectorMap(0, sectorMap, [crusadePlanet()]);
    expect(result.nodes[0]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("colors planets by sideOwner: For -> imperial, Against -> devastation, no owner -> neutral", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [
        { planetId: "for-planet", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
        { planetId: "against-planet", zone: 0, type: "Fortress", positionX: 1, positionY: 1 },
        { planetId: "unowned-planet", zone: 0, type: "Fortress", positionX: 2, positionY: 2 },
      ],
      connections: [],
    };
    const result = computeSectorMap(0, sectorMap, [
      crusadePlanet({ planetId: "for-planet", sideOwner: "For" }),
      crusadePlanet({ planetId: "against-planet", sideOwner: "Against" }),
    ]);

    expect(result.nodes.find((n) => n.planetId === "for-planet")?.color).toBe("imperial");
    expect(result.nodes.find((n) => n.planetId === "against-planet")?.color).toBe("devastation");
    expect(result.nodes.find((n) => n.planetId === "unowned-planet")?.color).toBe("neutral");
  });

  it("only includes planets from the requested zone", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [
        { planetId: "planet_001", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
        { planetId: "planet_099", zone: 3, type: "Fortress", positionX: 0, positionY: 0 },
      ],
      connections: [],
    };
    const result = computeSectorMap(0, sectorMap, [crusadePlanet()]);
    expect(result.nodes.map((n) => n.planetId)).toEqual(["planet_001"]);
  });

  it("omits NotPlayable planets entirely - their nodes, their connections, and their effect on the layout bounds", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [
        { planetId: "planet_001", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
        { planetId: "planet_002", zone: 0, type: "Civilized", positionX: 10, positionY: 10 },
        // Far outside the playable planets' bounds - would squash them into a corner if it counted.
        { planetId: "scenery", zone: 0, type: "NotPlayable", positionX: 1000, positionY: 1000 },
      ],
      connections: [
        { planet1: "planet_001", planet2: "planet_002" },
        { planet1: "planet_002", planet2: "scenery" },
      ],
    };
    const result = computeSectorMap(0, sectorMap, [crusadePlanet({ planetId: "planet_001" }), crusadePlanet({ planetId: "planet_002" })]);

    expect(result.nodes.map((n) => n.planetId)).toEqual(["planet_001", "planet_002"]);
    expect(result.edges).toHaveLength(1);
    // Normalized over just the two playable planets, so they still span the full [0,1] box.
    expect(result.nodes.find((n) => n.planetId === "planet_002")).toMatchObject({ x: 1, y: 0 });
  });

  it("keeps a same-zone connection but drops one that crosses sector boundaries", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [
        { planetId: "planet_001", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
        { planetId: "planet_002", zone: 0, type: "Fortress", positionX: 1, positionY: 1 },
        { planetId: "planet_099", zone: 3, type: "Fortress", positionX: 0, positionY: 0 },
      ],
      connections: [
        { planet1: "planet_001", planet2: "planet_002" }, // same zone - kept
        { planet1: "planet_001", planet2: "planet_099" }, // crosses zones - dropped
      ],
    };
    const result = computeSectorMap(0, sectorMap, [crusadePlanet({ planetId: "planet_001" }), crusadePlanet({ planetId: "planet_002" })]);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from.planetId).toBe("planet_001");
    expect(result.edges[0].to.planetId).toBe("planet_002");
  });
});

describe("computeSectorMap progress", () => {
  const sectorMap: CrusadeSectorMap = {
    planets: [
      { planetId: "with-struggle", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
      { planetId: "no-struggle", zone: 0, type: "Fortress", positionX: 1, positionY: 1 },
      { planetId: "not-in-crusade-data", zone: 0, type: "Fortress", positionX: 2, positionY: 2 },
    ],
    connections: [],
  };

  it("attaches conquest progress, with the defender/attacker threshold swap decided by sideOwner", () => {
    const result = computeSectorMap(0, sectorMap, [
      // Imperial owns the planet, so it's measured against the Defender threshold and Devastation
      // (the attacker) against the Attacker threshold.
      crusadePlanet({
        planetId: "with-struggle",
        sideOwner: "For",
        pointsFor: 500,
        pointsAgainst: 250,
        struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 2000 },
      }),
      crusadePlanet({ planetId: "no-struggle" }),
    ]);
    expect(result.nodes.find((n) => n.planetId === "with-struggle")!.progress).toMatchObject({
      imperialCurrent: 500,
      imperialThreshold: 2000,
      devastationCurrent: 250,
      devastationThreshold: 1000,
    });
  });

  it("has no progress for a planet without struggle data, or one missing from the crusade data", () => {
    const result = computeSectorMap(0, sectorMap, [crusadePlanet({ planetId: "no-struggle" })]);
    expect(result.nodes.find((n) => n.planetId === "no-struggle")!.progress).toBeNull();
    expect(result.nodes.find((n) => n.planetId === "not-in-crusade-data")!.progress).toBeNull();
  });
});

describe("planetProgressBars", () => {
  function progress(overrides: Partial<ConquestProgress> = {}): ConquestProgress {
    return {
      imperialCurrent: 500,
      imperialThreshold: 2000,
      imperialPercent: 25,
      devastationCurrent: 250,
      devastationThreshold: 1000,
      devastationPercent: 25,
      ...overrides,
    };
  }

  it("returns each side's fraction of its own threshold while neither has reached it", () => {
    expect(planetProgressBars(progress())).toEqual({ imperial: 0.25, devastation: 0.25 });
  });

  it("returns nothing when there's no progress data", () => {
    expect(planetProgressBars(null)).toBeNull();
  });

  it("omits BOTH bars once Imperial has exactly reached its threshold, even though Devastation hasn't", () => {
    expect(planetProgressBars(progress({ imperialCurrent: 2000 }))).toBeNull();
  });

  it("omits BOTH bars once Devastation has passed its threshold, even though Imperial hasn't", () => {
    expect(planetProgressBars(progress({ devastationCurrent: 1500 }))).toBeNull();
  });

  it("omits BOTH bars when neither side has scored any points yet", () => {
    expect(planetProgressBars(progress({ imperialCurrent: 0, devastationCurrent: 0 }))).toBeNull();
  });

  it("gives a side at zero an empty bar rather than omitting it, as long as the other side has scored", () => {
    expect(planetProgressBars(progress({ imperialCurrent: 0 }))).toEqual({ imperial: 0, devastation: 0.25 });
  });

  it("clamps negative progress to zero", () => {
    expect(planetProgressBars(progress({ imperialCurrent: -10 }))?.imperial).toBe(0);
  });

  it("treats a zero threshold as reached (no divide-by-zero)", () => {
    expect(planetProgressBars(progress({ imperialThreshold: 0 }))).toBeNull();
  });
});

describe("sectorZones", () => {
  it("lists each zone with a playable planet once, in order", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [
        { planetId: "a", zone: 2, type: "Fortress", positionX: 0, positionY: 0 },
        { planetId: "b", zone: 0, type: "Hive", positionX: 0, positionY: 0 },
        { planetId: "c", zone: 2, type: "Feral", positionX: 0, positionY: 0 },
      ],
      connections: [],
    };
    expect(sectorZones(sectorMap)).toEqual([0, 2]);
  });

  it("ignores a zone that only has NotPlayable planets", () => {
    const sectorMap: CrusadeSectorMap = {
      planets: [
        { planetId: "a", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
        { planetId: "scenery", zone: 1, type: "NotPlayable", positionX: 0, positionY: 0 },
      ],
      connections: [],
    };
    expect(sectorZones(sectorMap)).toEqual([0]);
  });

  it("is empty for an empty map", () => {
    expect(sectorZones({ planets: [], connections: [] })).toEqual([]);
  });
});

describe("adjacentZone", () => {
  const zones = [0, 1, 2, 3, 4, 5];

  it("steps forward and back", () => {
    expect(adjacentZone(zones, 2, 1)).toBe(3);
    expect(adjacentZone(zones, 2, -1)).toBe(1);
  });

  it("wraps around at both ends", () => {
    expect(adjacentZone(zones, 5, 1)).toBe(0);
    expect(adjacentZone(zones, 0, -1)).toBe(5);
  });

  it("follows the given zones rather than assuming consecutive numbers", () => {
    expect(adjacentZone([0, 2, 5], 2, 1)).toBe(5);
    expect(adjacentZone([0, 2, 5], 0, -1)).toBe(5);
  });

  it("stays put when there's nothing to step to", () => {
    expect(adjacentZone([3], 3, 1)).toBe(3);
    expect(adjacentZone([], 3, -1)).toBe(3);
    expect(adjacentZone(zones, 99, 1)).toBe(99);
  });
});

describe("captureRequirement", () => {
  it("is the larger of the two sides' thresholds", () => {
    const base = { imperialCurrent: 0, imperialPercent: 0, devastationCurrent: 0, devastationPercent: 0 };
    expect(captureRequirement({ ...base, imperialThreshold: 2000, devastationThreshold: 1000 })).toBe(2000);
    expect(captureRequirement({ ...base, imperialThreshold: 1000, devastationThreshold: 4000 })).toBe(4000);
  });
});

describe("computeDotScales", () => {
  it("gives the highest requirement 0 (smallest) and the lowest 1 (largest), spaced evenly by rank", () => {
    const scales = computeDotScales(new Map([["a", 5000], ["b", 3000], ["c", 1000]]));
    expect(scales.get("a")).toBe(0);
    expect(scales.get("b")).toBe(0.5);
    expect(scales.get("c")).toBe(1);
  });

  it("spaces by rank rather than value, so one huge outlier doesn't squash everyone else", () => {
    const scales = computeDotScales(new Map([["outlier", 1_000_000], ["b", 3000], ["c", 2000], ["d", 1000]]));
    expect(scales.get("outlier")).toBe(0);
    expect(scales.get("b")).toBeCloseTo(1 / 3);
    expect(scales.get("c")).toBeCloseTo(2 / 3);
    expect(scales.get("d")).toBe(1);
  });

  it("gives planets tied on a requirement the same rank, and so the same size", () => {
    const scales = computeDotScales(new Map([["a", 5000], ["b", 5000], ["c", 1000]]));
    expect(scales.get("a")).toBe(0);
    expect(scales.get("b")).toBe(0);
    expect(scales.get("c")).toBe(1);
  });

  it("leaves everyone full size when there's only one distinct requirement to rank", () => {
    const scales = computeDotScales(new Map([["a", 2000], ["b", 2000]]));
    expect([...scales.values()]).toEqual([1, 1]);
  });

  it("is empty for no planets", () => {
    expect(computeDotScales(new Map()).size).toBe(0);
  });
});

describe("dotRadius", () => {
  it("runs from the ~1px minimum at scale 0 to the original full size at scale 1", () => {
    expect(dotRadius(0)).toBe(MIN_DOT_RADIUS);
    expect(dotRadius(1)).toBe(MAX_DOT_RADIUS);
    expect(dotRadius(0.5)).toBeCloseTo((MIN_DOT_RADIUS + MAX_DOT_RADIUS) / 2);
  });

  it("keeps the full-size dot when the planet has no requirement data", () => {
    expect(dotRadius(null)).toBe(MAX_DOT_RADIUS);
  });
});

describe("computeSectorMap dot scale", () => {
  const sectorMap: CrusadeSectorMap = {
    planets: [
      { planetId: "hard", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
      { planetId: "easy", zone: 1, type: "Fortress", positionX: 0, positionY: 0 },
      { planetId: "medium", zone: 1, type: "Fortress", positionX: 5, positionY: 5 },
      { planetId: "unknown", zone: 1, type: "Fortress", positionX: 9, positionY: 9 },
      { planetId: "scenery", zone: 1, type: "NotPlayable", positionX: 1, positionY: 1 },
    ],
    connections: [],
  };
  function planetWith(planetId: string, attacker: number, defender: number): CrusadePlanet {
    return crusadePlanet({
      planetId,
      sideOwner: "For",
      pointsFor: 1,
      pointsAgainst: 1,
      struggleData: { conquestThresholdPointsAttacker: attacker, conquestThresholdPointsDefender: defender },
    });
  }

  it("ranks capture requirements across the whole crusade, not just the sector being drawn", () => {
    const planets = [planetWith("hard", 9000, 8000), planetWith("medium", 3000, 2000), planetWith("easy", 1000, 500), crusadePlanet({ planetId: "unknown" })];
    // "hard" is in zone 0 but sets the top of the ranking that zone 1's planets are measured against.
    const zone1 = computeSectorMap(1, sectorMap, planets);
    expect(zone1.nodes.find((n) => n.planetId === "easy")!.dotScale).toBe(1);
    expect(zone1.nodes.find((n) => n.planetId === "medium")!.dotScale).toBe(0.5);
    expect(computeSectorMap(0, sectorMap, planets).nodes[0].dotScale).toBe(0);
  });

  it("uses the larger of a planet's two thresholds as its requirement", () => {
    // Imperial owns it, so Devastation (attacker) faces 9000 and Imperial (defender) faces 100 - the
    // 9000 is what ranks it.
    const planets = [planetWith("hard", 9000, 100), planetWith("easy", 1000, 500)];
    expect(computeSectorMap(0, sectorMap, planets).nodes[0].dotScale).toBe(0);
  });

  it("leaves a planet with no threshold data unscaled, and doesn't count it in the ranking", () => {
    const planets = [planetWith("hard", 9000, 8000), planetWith("easy", 1000, 500), crusadePlanet({ planetId: "unknown" })];
    const unknown = computeSectorMap(1, sectorMap, planets).nodes.find((n) => n.planetId === "unknown")!;
    expect(unknown.dotScale).toBeNull();
    expect(computeSectorMap(1, sectorMap, planets).nodes.find((n) => n.planetId === "easy")!.dotScale).toBe(1);
  });
});

describe("computeAllSectorsMap", () => {
  const sectorMap: CrusadeSectorMap = {
    planets: [
      { planetId: "a", zone: 0, type: "Fortress", positionX: 0, positionY: 0 },
      { planetId: "b", zone: 0, type: "Civilized", positionX: 100, positionY: 100 },
      { planetId: "c", zone: 1, type: "Civilized", positionX: 300, positionY: 50 },
      { planetId: "scenery", zone: 1, type: "NotPlayable", positionX: 900, positionY: 50 },
    ],
    connections: [
      { planet1: "a", planet2: "b" },
      { planet1: "b", planet2: "c" }, // crosses sectors
      { planet1: "c", planet2: "scenery" },
    ],
  };

  it("draws connections between sectors and omits NotPlayable planets", () => {
    const map = computeAllSectorsMap(sectorMap, []);
    expect(map.nodes.map((n) => n.planetId).sort()).toEqual(["a", "b", "c"]);
    expect(map.edges.map((e) => [e.from.planetId, e.to.planetId])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("uses one shared scale: x runs [0, aspect], y runs [0, 1]", () => {
    const map = computeAllSectorsMap(sectorMap, []);
    const byId = new Map(map.nodes.map((n) => [n.planetId, n]));
    expect(map.aspect).toBe(3);
    expect(byId.get("a")).toMatchObject({ x: 0, y: 1 });
    expect(byId.get("c")).toMatchObject({ x: 3, y: 0.5 });
  });

  it("labels each sector at the center of its planets", () => {
    const map = computeAllSectorsMap(sectorMap, []);
    expect(map.sectorLabels).toEqual([
      { zone: 0, x: 0.5 },
      { zone: 1, x: 3 },
    ]);
  });

  it("puts a boundary midway through the gap between neighboring sectors", () => {
    expect(computeAllSectorsMap(sectorMap, []).sectorBoundaries).toEqual([2]);
  });
});

import { describe, expect, it } from "vitest";
import { appendToHistoryCache, buildHistoryRow, isEraReset, rawPlanetToCrusadePlanet, type PlanetHistoryRow } from "./planet-history";

describe("rawPlanetToCrusadePlanet", () => {
  it("maps the fields pointsRemaining/isDominationSunk actually read, with placeholder name/zone", () => {
    const result = rawPlanetToCrusadePlanet({
      planetId: "planet_042",
      sideOwner: "For",
      ownedByFaction: "Custodes",
      pointsFor: 100,
      pointsAgainst: 50,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(result).toEqual({
      planetId: "planet_042",
      name: "planet_042",
      zone: null,
      sideOwner: "For",
      ownedByFaction: "Custodes",
      pointsFor: 100,
      pointsAgainst: 50,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
  });
});

describe("buildHistoryRow", () => {
  it("computes remaining points and sunk for a live contested planet", () => {
    const planet = rawPlanetToCrusadePlanet({
      planetId: "planet_001",
      sideOwner: "For",
      pointsFor: 100,
      pointsAgainst: 50,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(buildHistoryRow(planet, 5000)).toEqual({
      planetId: "planet_001",
      atMs: 5000,
      imperialRemaining: 900,
      devastationRemaining: 950,
      sunk: false,
    });
  });

  it("marks sunk true once a side has reached its own threshold", () => {
    const planet = rawPlanetToCrusadePlanet({
      planetId: "planet_001",
      sideOwner: "For",
      pointsFor: 1000,
      pointsAgainst: 50,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(buildHistoryRow(planet, 5000).sunk).toBe(true);
  });

  it("marks sunk true for the idle (0/0) cooldown state too", () => {
    const planet = rawPlanetToCrusadePlanet({
      planetId: "planet_001",
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(buildHistoryRow(planet, 5000).sunk).toBe(true);
  });
});

describe("isEraReset", () => {
  it("is true only when a planet flips from sunk to trackable", () => {
    expect(isEraReset(true, false)).toBe(true);
  });

  it("is false when staying sunk", () => {
    expect(isEraReset(true, true)).toBe(false);
  });

  it("is false when staying trackable", () => {
    expect(isEraReset(false, false)).toBe(false);
  });

  it("is false when newly becoming sunk", () => {
    expect(isEraReset(false, true)).toBe(false);
  });

  it("is false when there's no prior history yet (null)", () => {
    expect(isEraReset(null, false)).toBe(false);
    expect(isEraReset(null, true)).toBe(false);
  });
});

describe("appendToHistoryCache", () => {
  function row(overrides: Partial<PlanetHistoryRow> = {}): PlanetHistoryRow {
    return { planetId: "planet_001", atMs: 1000, imperialRemaining: 900, devastationRemaining: 800, sunk: false, ...overrides };
  }

  it("starts a fresh single-sample array when there's no existing entry yet", () => {
    expect(appendToHistoryCache(null, row())).toEqual({
      samples: [{ atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 }],
      lastSunk: false,
    });
  });

  it("appends to the existing samples when the planet is still in the same era", () => {
    const existing = { samples: [{ atMs: 500, imperialRemaining: 950, devastationRemaining: 900 }], lastSunk: false };
    expect(appendToHistoryCache(existing, row())).toEqual({
      samples: [
        { atMs: 500, imperialRemaining: 950, devastationRemaining: 900 },
        { atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 },
      ],
      lastSunk: false,
    });
  });

  it("starts a fresh single-sample array on an era reset (sunk -> trackable), discarding the old era's samples", () => {
    const existing = { samples: [{ atMs: 500, imperialRemaining: 0, devastationRemaining: 900 }], lastSunk: true };
    expect(appendToHistoryCache(existing, row({ sunk: false }))).toEqual({
      samples: [{ atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 }],
      lastSunk: false,
    });
  });

  it("keeps accumulating while staying sunk (e.g. still in cooldown)", () => {
    const existing = { samples: [{ atMs: 500, imperialRemaining: 0, devastationRemaining: 900 }], lastSunk: true };
    expect(appendToHistoryCache(existing, row({ sunk: true })).samples).toHaveLength(2);
  });
});

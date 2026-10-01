import { describe, expect, it } from "vitest";
import { buildHistoryRow, isEraReset, rawPlanetToCrusadePlanet } from "./planet-history";

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

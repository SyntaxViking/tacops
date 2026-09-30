import { describe, expect, it } from "vitest";
import { isPlanetTrackable, isTrackDisabled, toggleTrackedPlanetId } from "./tracked-planet";
import type { CrusadePlanet } from "../api/types";

function planet(overrides: Partial<CrusadePlanet> = {}): CrusadePlanet {
  return { planetId: "planet_001", name: "Test Planet", zone: null, ...overrides };
}

describe("isPlanetTrackable", () => {
  it("is false when the planet has no struggleData (not Domination-active)", () => {
    expect(isPlanetTrackable(planet())).toBe(false);
  });

  it("is false when the planet is already captured (a side reached its threshold)", () => {
    const p = planet({
      sideOwner: "For",
      pointsFor: 10,
      pointsAgainst: 1000,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 2000 },
    });
    expect(isPlanetTrackable(p)).toBe(false);
  });

  it("is false when the planet is in post-capture cooldown (both sides at 0)", () => {
    const p = planet({ struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 } });
    expect(isPlanetTrackable(p)).toBe(false);
  });

  it("is true when both sides have points left to capture and neither is sunk", () => {
    const p = planet({
      sideOwner: "For",
      pointsFor: 10,
      pointsAgainst: 10,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(isPlanetTrackable(p)).toBe(true);
  });

});

describe("isTrackDisabled", () => {
  it("is false for any planet when nothing is tracked", () => {
    expect(isTrackDisabled(null, "planet_001")).toBe(false);
  });

  it("is false for the currently-tracked planet itself (so it can be untracked)", () => {
    expect(isTrackDisabled("planet_001", "planet_001")).toBe(false);
  });

  it("is true for every other planet while one is tracked", () => {
    expect(isTrackDisabled("planet_001", "planet_002")).toBe(true);
  });
});

describe("toggleTrackedPlanetId", () => {
  it("tracks a planet when nothing is currently tracked", () => {
    expect(toggleTrackedPlanetId(null, "planet_001")).toBe("planet_001");
  });

  it("untracks the currently-tracked planet when clicked again", () => {
    expect(toggleTrackedPlanetId("planet_001", "planet_001")).toBeNull();
  });

  it("switches to a different planet id (pure function - the UI is what actually prevents this via isTrackDisabled)", () => {
    expect(toggleTrackedPlanetId("planet_001", "planet_002")).toBe("planet_002");
  });
});

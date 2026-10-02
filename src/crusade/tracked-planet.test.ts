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
  const trackable = planet({
    planetId: "planet_002",
    sideOwner: "For",
    pointsFor: 10,
    pointsAgainst: 10,
    struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
  });
  const sunk = planet({
    planetId: "planet_003",
    struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
  });

  it("is false for a trackable planet when nothing is tracked", () => {
    expect(isTrackDisabled(null, trackable)).toBe(false);
  });

  it("is false for the currently-tracked planet itself, even if it's since become untrackable (so it can always be untracked)", () => {
    expect(isTrackDisabled("planet_003", sunk)).toBe(false);
  });

  it("is false for a different, trackable planet while another one is tracked - clicking it switches tracking straight to it", () => {
    expect(isTrackDisabled("planet_001", trackable)).toBe(false);
  });

  it("is true for a planet that isn't itself trackable, whether or not anything is tracked", () => {
    expect(isTrackDisabled(null, sunk)).toBe(true);
    expect(isTrackDisabled("planet_001", sunk)).toBe(true);
  });
});

describe("toggleTrackedPlanetId", () => {
  it("tracks a planet when nothing is currently tracked", () => {
    expect(toggleTrackedPlanetId(null, "planet_001")).toBe("planet_001");
  });

  it("untracks the currently-tracked planet when clicked again", () => {
    expect(toggleTrackedPlanetId("planet_001", "planet_001")).toBeNull();
  });

  it("switches to a different planet id, discarding whatever was tracked before", () => {
    expect(toggleTrackedPlanetId("planet_001", "planet_002")).toBe("planet_002");
  });
});

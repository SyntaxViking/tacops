import { describe, expect, it } from "vitest";
import { relevantPlanetIds } from "./poller";

describe("relevantPlanetIds", () => {
  it("returns all 143 planets during STRUGGLE", () => {
    expect(relevantPlanetIds("STRUGGLE", null)).toHaveLength(143);
  });

  it("returns just the active zone's planets during CRUSADE, matching planet-data.json's real zone sizes", () => {
    const zoneSizes = [24, 24, 24, 24, 23, 24];
    zoneSizes.forEach((size, zone) => {
      expect(relevantPlanetIds("CRUSADE", zone)).toHaveLength(size);
    });
  });

  it("returns nothing during DOWNTIME or an unknown phase", () => {
    expect(relevantPlanetIds("DOWNTIME", null)).toEqual([]);
    expect(relevantPlanetIds(null, null)).toEqual([]);
  });

  it("returns nothing for CRUSADE with no active zone", () => {
    expect(relevantPlanetIds("CRUSADE", null)).toEqual([]);
  });
});

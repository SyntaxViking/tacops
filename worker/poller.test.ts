import { describe, expect, it } from "vitest";
import { allLeaderboardIdsForPlanet, findActivePhase, relevantPlanetIds } from "./poller";

describe("relevantPlanetIds", () => {
  it("returns all 146 planets during STRUGGLE", () => {
    expect(relevantPlanetIds("STRUGGLE", null)).toHaveLength(146);
  });

  it("returns just the active zone's planets during CRUSADE, matching planet-data.json's real zone sizes", () => {
    const zoneSizes = [24, 24, 20, 23, 26, 29];
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

describe("findActivePhase", () => {
  const now = Date.now();

  it("resolves a CRUSADE phase's 1-based zone string down to a 0-based activeZone", () => {
    const result = findActivePhase(undefined, [{ phase: "CRUSADE", zone: "zone3", startsOn: now - 1000, endsOn: now + 1000 }], undefined);
    expect(result).toEqual({ phase: "CRUSADE", activeZone: 2 });
  });

  it("resolves STRUGGLE with no activeZone", () => {
    const result = findActivePhase(undefined, [], { phase: "STRUGGLE", startsOn: now - 1000, endsOn: now + 1000 });
    expect(result).toEqual({ phase: "STRUGGLE", activeZone: null });
  });

  it("resolves DOWNTIME with no activeZone", () => {
    const result = findActivePhase({ phase: "DOWNTIME", startsOn: now - 1000, endsOn: now + 1000 }, [], undefined);
    expect(result).toEqual({ phase: "DOWNTIME", activeZone: null });
  });

  it("returns phase: null when nothing brackets now", () => {
    const result = findActivePhase({ phase: "DOWNTIME", startsOn: now - 2000, endsOn: now - 1000 }, [], undefined);
    expect(result).toEqual({ phase: null, activeZone: null });
  });
});

describe("allLeaderboardIdsForPlanet", () => {
  it("builds the side-player ids plus one per-faction player id for every faction, never the crusadeFaction aggregate ids", () => {
    const ids = allLeaderboardIdsForPlanet("crusade1", 3, "planet_042");
    expect(ids[0]).toBe("crusadePlayer:crusade_leaderboard_planet_side_players_crusade1_3_planet_042_for");
    expect(ids[1]).toBe("crusadePlayer:crusade_leaderboard_planet_side_players_crusade1_3_planet_042_against");
    expect(ids).toContain("crusadePlayer:crusade_leaderboard_planet_faction_players_crusade1_3_planet_042_Custodes");
    expect(ids).toContain("crusadePlayer:crusade_leaderboard_planet_faction_players_crusade1_3_planet_042_Necrons");
    expect(ids.some((id) => id.startsWith("crusadeFaction:"))).toBe(false);
    // 2 side ids + one per faction (22 factions)
    expect(ids).toHaveLength(24);
  });
});

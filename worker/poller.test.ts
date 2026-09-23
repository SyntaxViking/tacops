import { describe, expect, it } from "vitest";
import { factionLeaderboardIds, findActivePhase, nextBatch, relevantPlanetIds } from "./poller";

describe("nextBatch", () => {
  it("takes the next batchSize ids starting at the cursor", () => {
    const { batch, nextCursor } = nextBatch(["a", "b", "c", "d", "e"], 1, 2);
    expect(batch).toEqual(["b", "c"]);
    expect(nextCursor).toBe(3);
  });

  it("wraps around the end of the list", () => {
    const { batch, nextCursor } = nextBatch(["a", "b", "c", "d", "e"], 4, 2);
    expect(batch).toEqual(["e", "a"]);
    expect(nextCursor).toBe(1);
  });

  it("self-corrects when the cursor is stale (relevant set shrank since it was saved)", () => {
    const { batch, nextCursor } = nextBatch(["a", "b", "c"], 100, 2);
    // 100 % 3 === 1
    expect(batch).toEqual(["b", "c"]);
    expect(nextCursor).toBe(0);
  });

  it("returns the whole list when batchSize exceeds it", () => {
    const { batch, nextCursor } = nextBatch(["a", "b"], 0, 20);
    expect(batch).toEqual(["a", "b"]);
    expect(nextCursor).toBe(0);
  });

  it("returns an empty batch for an empty id list", () => {
    expect(nextBatch([], 5, 20)).toEqual({ batch: [], nextCursor: 0 });
  });
});

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

describe("factionLeaderboardIds", () => {
  it("builds the _for/_against faction leaderboard ids, never the account-specific player ids", () => {
    const ids = factionLeaderboardIds("crusade1", 3, "planet_042");
    expect(ids).toEqual({
      factionFor: "crusadeFaction:crusade_leaderboard_planet_side_factions_crusade1_3_planet_042_for",
      factionAgainst: "crusadeFaction:crusade_leaderboard_planet_side_factions_crusade1_3_planet_042_against",
    });
  });
});

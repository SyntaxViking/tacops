import { describe, expect, it } from "vitest";
import { seedPlanetRefreshStateFromCache } from "./crusade-cache-seed";
import { leaderboardIdsForPlanet } from "./fetch-crusade-data";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";

const CRUSADE_ID = "crusade1";
const SEASON = 3;
const now = Date.now();

function crusadeRaw(overrides: Record<string, unknown> = {}) {
  return {
    crusadeId: CRUSADE_ID,
    seasonNumber: SEASON,
    chosenSide: "for",
    forFactionId: "Ultramarines",
    againstFactionId: "Necrons",
    downtimePhase: { phase: "DOWNTIME", startsOn: now - 10_000_000, endsOn: now - 5_000_000 },
    crusadePhases: [{ phase: "CRUSADE", zone: "zone1", startsOn: now - 1000, endsOn: now + 1_000_000 }],
    strugglePhase: { phase: "STRUGGLE", startsOn: now + 2_000_000, endsOn: now + 3_000_000 },
    planetsData: [
      { planetId: "planet_001", sideOwner: "for", ownedByFaction: "Ultramarines", pointsFor: 100, pointsAgainst: 50 },
      { planetId: "planet_002", sideOwner: "for", ownedByFaction: "Ultramarines", pointsFor: 80, pointsAgainst: 20 },
    ],
    ...overrides,
  };
}

function leaderboardsFor(planetId: string) {
  const ids = leaderboardIdsForPlanet(CRUSADE_ID, SEASON, planetId);
  return {
    [ids.factionFor]: { numParticipants: 2, topEntries: [{ position: 0, points: 500, factionId: "Ultramarines" }] },
    [ids.factionAgainst]: { numParticipants: 2, topEntries: [{ position: 0, points: 400, factionId: "Necrons" }] },
  };
}

describe("seedPlanetRefreshStateFromCache", () => {
  it("returns an empty seed when there's no cached crusade snapshot yet", () => {
    const cache: CrusadeCacheResponse = { crusadeRaw: null, crusadeFetchedAt: null, leaderboards: {} };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData).toBeNull();
    expect(result.planetRefreshState.size).toBe(0);
  });

  it("seeds only the active zone's planets during CRUSADE, populating cached leaderboards", () => {
    const cache: CrusadeCacheResponse = {
      crusadeRaw: crusadeRaw(),
      crusadeFetchedAt: now,
      leaderboards: { planet_001: { raw: leaderboardsFor("planet_001"), fetchedAt: now } },
    };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData?.phase).toBe("CRUSADE");
    // "zone1" (1-based, from the raw phase schedule) maps to activeZone 0 (0-based, findActivePhase's
    // convention) - planet_001/planet_002 are both zone 0 in planet-data.json, so both are active.
    expect(result.planetRefreshState.has("planet_001")).toBe(true);
    const entry = result.planetRefreshState.get("planet_001");
    expect(entry?.leaderboard?.topFactionsFor).toEqual([{ factionId: "Ultramarines", points: 500 }]);
    expect(entry?.leaderboard?.topFactionsAgainst).toEqual([{ factionId: "Necrons", points: 400 }]);
    expect(entry?.leaderboard?.side).toBeNull();
    expect(entry?.leaderboard?.faction).toBeNull();
  });

  it("marks an active planet with no cache entry yet as not-yet-loaded rather than omitting it", () => {
    const cache: CrusadeCacheResponse = { crusadeRaw: crusadeRaw(), crusadeFetchedAt: now, leaderboards: {} };
    const result = seedPlanetRefreshStateFromCache(cache);
    const entry = result.planetRefreshState.get("planet_001");
    expect(entry).toBeDefined();
    expect(entry?.leaderboard).toBeNull();
    expect(entry?.isLoading).toBe(false);
  });

  it("seeds every planet during STRUGGLE, not just one zone", () => {
    const cache: CrusadeCacheResponse = {
      crusadeRaw: crusadeRaw({
        crusadePhases: [],
        strugglePhase: { phase: "STRUGGLE", startsOn: now - 1000, endsOn: now + 1_000_000 },
      }),
      crusadeFetchedAt: now,
      leaderboards: {},
    };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData?.phase).toBe("STRUGGLE");
    expect(result.planetRefreshState.has("planet_001")).toBe(true);
    expect(result.planetRefreshState.has("planet_002")).toBe(true);
  });
});

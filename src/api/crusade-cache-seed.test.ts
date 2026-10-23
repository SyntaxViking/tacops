import { describe, expect, it } from "vitest";
import { seedPlanetRefreshStateFromCache, toSeededPlanetLeaderboard } from "./crusade-cache-seed";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";
import type { SharedPlanetLeaderboard } from "./types";

const CRUSADE_ID = "crusade1";
const SEASON = 3;
const now = Date.now();

// The cache stores the crusade snapshot completely untouched (see worker/poller.ts) - this fixture
// mirrors the real envelope shape, not the already-unwrapped eventResponseData.
function crusadeRaw(overrides: Record<string, unknown> = {}) {
  return {
    eventResults: [
      {
        eventResponseData: {
          crusadeId: CRUSADE_ID,
          seasonNumber: SEASON,
          chosenSide: "for",
          forFactionId: "Ultramarines",
          againstFactionId: "Necrons",
          downtimePhase: { phase: "DOWNTIME", startsOn: now - 10_000_000, endsOn: now - 5_000_000 },
          crusadePhases: [{ phase: "CRUSADE", zone: "zone1", startsOn: now - 1000, endsOn: now + 1_000_000 }],
          strugglePhase: { phase: "STRUGGLE", startsOn: now + 2_000_000, endsOn: now + 3_000_000 },
          planetsData: [
            { planetId: "planet_003", sideOwner: "for", ownedByFaction: "Ultramarines", pointsFor: 100, pointsAgainst: 50 },
            { planetId: "planet_002", sideOwner: "for", ownedByFaction: "Ultramarines", pointsFor: 80, pointsAgainst: 20 },
          ],
          ...overrides,
        },
      },
    ],
  };
}

describe("seedPlanetRefreshStateFromCache", () => {
  it("returns an empty seed when there's no cached crusade snapshot yet", () => {
    const cache: CrusadeCacheResponse = { crusadeRaw: null, crusadeFetchedAt: null };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData).toBeNull();
    expect(result.planetRefreshState.size).toBe(0);
  });

  it("seeds only the active zone's planets during CRUSADE, each with no leaderboard loaded yet", () => {
    const cache: CrusadeCacheResponse = { crusadeRaw: crusadeRaw(), crusadeFetchedAt: now };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData?.phase).toBe("CRUSADE");
    // "zone1" (1-based, from the raw phase schedule) maps to activeZone 0 (0-based, findActivePhase's
    // convention) - planet_003/planet_002 are both zone 0 in planet-data.json, so both are active.
    expect(result.planetRefreshState.has("planet_003")).toBe(true);
    expect(result.planetRefreshState.has("planet_002")).toBe(true);
    const entry = result.planetRefreshState.get("planet_003");
    expect(entry?.leaderboard).toBeNull();
    expect(entry?.lastSuccessAt).toBeNull();
    expect(entry?.lastAttemptAt).toBeNull();
    expect(entry?.lastAttemptFailed).toBe(false);
    expect(entry?.isLoading).toBe(false);
  });

  it("seeds every planet during STRUGGLE, not just one zone", () => {
    const cache: CrusadeCacheResponse = {
      crusadeRaw: crusadeRaw({
        crusadePhases: [],
        strugglePhase: { phase: "STRUGGLE", startsOn: now - 1000, endsOn: now + 1_000_000 },
      }),
      crusadeFetchedAt: now,
    };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData?.phase).toBe("STRUGGLE");
    expect(result.planetRefreshState.has("planet_003")).toBe(true);
    expect(result.planetRefreshState.has("planet_002")).toBe(true);
  });
});

const sharedCache: SharedPlanetLeaderboard = {
  topFactionsFor: [{ factionId: "Ultramarines", points: 500 }],
  topFactionsAgainst: [{ factionId: "Necrons", points: 400 }],
  sideFor: { numParticipants: 100, benchmarks: [{ rank: 1, points: 9000 }], topEntries: [{ rank: 1, points: 9000 }] },
  sideAgainst: { numParticipants: 80, benchmarks: [{ rank: 1, points: 8000 }], topEntries: [{ rank: 1, points: 8000 }] },
  perFaction: { Ultramarines: { numParticipants: 50, benchmarks: [{ rank: 1, points: 7000 }], topEntries: [{ rank: 1, points: 7000 }] } },
  fetchedAt: now,
};

describe("toSeededPlanetLeaderboard", () => {
  it("picks the side matching chosenSide, with no personal rank", () => {
    const result = toSeededPlanetLeaderboard("planet_003", sharedCache, "For", null);
    expect(result.side).toEqual({ numParticipants: 100, myRank: null, myPoints: null, benchmarks: [{ rank: 1, points: 9000 }], topEntries: [{ rank: 1, points: 9000 }], nearMe: [] });
  });

  it("matches chosenSide case-insensitively and picks the against side", () => {
    const result = toSeededPlanetLeaderboard("planet_003", sharedCache, "against", null);
    expect(result.side?.numParticipants).toBe(80);
  });

  it("populates .faction from perFaction when factionId is given and cached", () => {
    const result = toSeededPlanetLeaderboard("planet_003", sharedCache, "for", "Ultramarines");
    expect(result.faction).toEqual({ numParticipants: 50, myRank: null, myPoints: null, benchmarks: [{ rank: 1, points: 7000 }], topEntries: [{ rank: 1, points: 7000 }], nearMe: [] });
  });

  it("leaves .faction null when factionId is null", () => {
    expect(toSeededPlanetLeaderboard("planet_003", sharedCache, "for", null).faction).toBeNull();
  });

  it("leaves .faction null when the requested faction isn't in perFaction", () => {
    expect(toSeededPlanetLeaderboard("planet_003", sharedCache, "for", "Necrons").faction).toBeNull();
  });

  it("always keeps topFactionsFor/topFactionsAgainst and both sides' participant counts, regardless of chosenSide/factionId", () => {
    const result = toSeededPlanetLeaderboard("planet_003", sharedCache, "for", "Ultramarines");
    expect(result.topFactionsFor).toEqual(sharedCache.topFactionsFor);
    expect(result.topFactionsAgainst).toEqual(sharedCache.topFactionsAgainst);
    expect(result.forParticipants).toBe(100);
    expect(result.againstParticipants).toBe(80);
  });
});

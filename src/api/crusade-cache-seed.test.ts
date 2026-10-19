import { describe, expect, it } from "vitest";
import { seedPlanetRefreshStateFromCache } from "./crusade-cache-seed";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";

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

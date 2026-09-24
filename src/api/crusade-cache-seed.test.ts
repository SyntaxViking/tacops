import { describe, expect, it } from "vitest";
import { seedPlanetRefreshStateFromCache } from "./crusade-cache-seed";
import { factionPlayerLeaderboardId, leaderboardIdsForPlanet } from "./fetch-crusade-data";
import type { CrusadeCacheResponse } from "./fetch-crusade-cache";

const CRUSADE_ID = "crusade1";
const SEASON = 3;
const now = Date.now();

// The cache stores each Loki response completely untouched (see worker/poller.ts) - these fixtures
// mirror the real envelope shape, not the already-unwrapped eventResponseData.
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
            { planetId: "planet_001", sideOwner: "for", ownedByFaction: "Ultramarines", pointsFor: 100, pointsAgainst: 50 },
            { planetId: "planet_002", sideOwner: "for", ownedByFaction: "Ultramarines", pointsFor: 80, pointsAgainst: 20 },
          ],
          ...overrides,
        },
      },
    ],
  };
}

function leaderboardsRawFor(planetId: string) {
  const ids = leaderboardIdsForPlanet(CRUSADE_ID, SEASON, planetId);
  const custodesId = factionPlayerLeaderboardId(CRUSADE_ID, SEASON, planetId, "Custodes");
  return {
    eventResult: {
      eventResponseData: {
        leaderboards: {
          [ids.playerFor]: { numParticipants: 500, topEntries: [{ position: 0, points: 9000, participantId: "p1" }] },
          [ids.playerAgainst]: { numParticipants: 400, topEntries: [{ position: 0, points: 8000, participantId: "p2" }] },
          [custodesId]: { numParticipants: 50, topEntries: [{ position: 0, points: 3000, participantId: "p3" }] },
        },
      },
    },
  };
}

describe("seedPlanetRefreshStateFromCache", () => {
  it("returns an empty seed when there's no cached crusade snapshot yet", () => {
    const cache: CrusadeCacheResponse = { crusadeRaw: null, crusadeFetchedAt: null, leaderboards: {} };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData).toBeNull();
    expect(result.planetRefreshState.size).toBe(0);
  });

  it("seeds only the active zone's planets during CRUSADE, with empty topFactions (no longer cached) and null side/faction when no faction is picked", () => {
    const cache: CrusadeCacheResponse = {
      crusadeRaw: crusadeRaw(),
      crusadeFetchedAt: now,
      leaderboards: { planet_001: { raw: leaderboardsRawFor("planet_001"), fetchedAt: now } },
    };
    const result = seedPlanetRefreshStateFromCache(cache);
    expect(result.crusadeData?.phase).toBe("CRUSADE");
    // "zone1" (1-based, from the raw phase schedule) maps to activeZone 0 (0-based, findActivePhase's
    // convention) - planet_001/planet_002 are both zone 0 in planet-data.json, so both are active.
    expect(result.planetRefreshState.has("planet_001")).toBe(true);
    const entry = result.planetRefreshState.get("planet_001");
    expect(entry?.leaderboard?.topFactionsFor).toEqual([]);
    expect(entry?.leaderboard?.topFactionsAgainst).toEqual([]);
    expect(entry?.leaderboard?.side).toBeNull();
    expect(entry?.leaderboard?.faction).toBeNull();
  });

  it("populates the Side and Faction Leaderboards with benchmarks when a 'for' faction is picked", () => {
    const cache: CrusadeCacheResponse = {
      crusadeRaw: crusadeRaw(),
      crusadeFetchedAt: now,
      leaderboards: { planet_001: { raw: leaderboardsRawFor("planet_001"), fetchedAt: now } },
    };
    const result = seedPlanetRefreshStateFromCache(cache, "Custodes");
    const entry = result.planetRefreshState.get("planet_001");
    // Custodes is Imperium ("for") - mergeSideLeaderboard falls back to the "for" side since there's
    // no personal identity to match (myUserId is always "").
    expect(entry?.leaderboard?.side?.numParticipants).toBe(500);
    expect(entry?.leaderboard?.side?.myRank).toBeNull();
    expect(entry?.leaderboard?.side?.benchmarks.length).toBeGreaterThan(0);
    expect(entry?.leaderboard?.faction?.numParticipants).toBe(50);
    expect(entry?.leaderboard?.faction?.benchmarks.length).toBeGreaterThan(0);
  });

  it("falls back to the 'against' side leaderboard when an against-side faction is picked", () => {
    const cache: CrusadeCacheResponse = {
      crusadeRaw: crusadeRaw(),
      crusadeFetchedAt: now,
      leaderboards: { planet_001: { raw: leaderboardsRawFor("planet_001"), fetchedAt: now } },
    };
    const result = seedPlanetRefreshStateFromCache(cache, "Necrons");
    const entry = result.planetRefreshState.get("planet_001");
    expect(entry?.leaderboard?.side?.numParticipants).toBe(400);
    // No cached leaderboard entry exists for "Necrons" in this fixture (only Custodes) - faction
    // should gracefully come back null rather than throwing.
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

import { describe, expect, it } from "vitest";
import { leaderboardIdsForPlanet as clientLeaderboardIdsForPlanet } from "../src/api/fetch-crusade-data";
import { buildSharedSide, leaderboardIdsForPlanet, readLeaderboard, topFactionStandings } from "./leaderboard-cache";

describe("leaderboardIdsForPlanet", () => {
  it("matches the client-side version's output exactly", () => {
    expect(leaderboardIdsForPlanet("crusade_1", 2, "planet_041")).toEqual(clientLeaderboardIdsForPlanet("crusade_1", 2, "planet_041"));
  });
});

// Same real-capture fixture as src/api/fetch-crusade-data.test.ts's readLeaderboard/
// mergeSideLeaderboard tests - planet_041's crusadePlayer "_against" leaderboard, where the
// player (myRank 53) doesn't place in topEntries, hence localEntries being populated.
const realAgainstEntry = {
  numParticipants: 1858,
  myRank: 53,
  myPoints: 9319,
  topEntries: [
    { position: 0, points: 18227 },
    { position: 4, points: 13946 },
    { position: 9, points: 13194, factionId: "WorldEaters" },
    { position: 24, points: 11487 },
  ],
  localEntries: [{ position: 53, points: 9319, participantId: "a4f01b7c-bfd5-431b-aa9c-9e22eb00e6fa", factionId: "WorldEaters" }],
};

describe("readLeaderboard", () => {
  it("never reads myRank/myPoints/localEntries at all, regardless of what's in the raw entry", () => {
    const result = readLeaderboard({ someId: realAgainstEntry }, "someId");
    expect(result).toEqual({
      numParticipants: 1858,
      topEntries: [
        { position: 0, points: 18227 },
        { position: 4, points: 13946 },
        { position: 9, points: 13194, factionId: "WorldEaters" },
        { position: 24, points: 11487 },
      ],
    });
    expect(result).not.toHaveProperty("myRank");
    expect(result).not.toHaveProperty("myPoints");
    expect(result).not.toHaveProperty("localEntries");
  });

  it("returns null when the leaderboard id has no real entry (missing numParticipants)", () => {
    expect(readLeaderboard({ someId: {} }, "someId")).toBeNull();
    expect(readLeaderboard({}, "someId")).toBeNull();
  });
});

describe("buildSharedSide", () => {
  it("produces numParticipants/benchmarks/topEntries with no myRank/myPoints/nearMe keys at all", () => {
    const entry = readLeaderboard({ someId: realAgainstEntry }, "someId");
    const result = buildSharedSide(entry);
    expect(result).toEqual({
      numParticipants: 1858,
      benchmarks: [
        { rank: 1, points: 18227 },
        { rank: 5, points: 13946 },
        { rank: 10, points: 13194 },
        { rank: 25, points: 11487 },
      ],
      topEntries: [
        { rank: 1, points: 18227 },
        { rank: 5, points: 13946 },
        { rank: 10, points: 13194 },
        { rank: 25, points: 11487 },
      ],
    });
    expect(result).not.toHaveProperty("myRank");
    expect(result).not.toHaveProperty("myPoints");
    expect(result).not.toHaveProperty("nearMe");
  });

  it("returns null for a missing entry", () => {
    expect(buildSharedSide(null)).toBeNull();
  });
});

describe("topFactionStandings", () => {
  it("extracts factionId/points pairs, skipping rows with no factionId", () => {
    const entry = readLeaderboard({ someId: realAgainstEntry }, "someId");
    expect(topFactionStandings(entry)).toEqual([{ factionId: "WorldEaters", points: 13194 }]);
  });

  it("returns an empty array for a missing entry", () => {
    expect(topFactionStandings(null)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { readLeaderboard, topFactionStandings } from "../src/crusade/leaderboard-parsing";
import { buildSharedSide } from "./leaderboard-cache";

// Same real-capture fixture as src/crusade/leaderboard-parsing.test.ts's readLeaderboard tests -
// planet_041's crusadePlayer "_against" leaderboard. myRank/myPoints are deliberately populated
// here (as they would be for whichever account made the request) so the buildSharedSide tests
// below are a meaningful check that they get stripped, not a vacuous one.
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

describe("buildSharedSide", () => {
  it("strips myRank/myPoints/nearMe even though readLeaderboard's own output carries them (safety invariant - see this file's own top-of-file comment)", () => {
    const entry = readLeaderboard({ someId: realAgainstEntry }, "someId", "poller-service-account");
    expect(entry?.myRank).not.toBeNull(); // sanity check: the raw parse DOES have a rank here
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
    const entry = readLeaderboard({ someId: realAgainstEntry }, "someId", "poller-service-account");
    expect(topFactionStandings(entry)).toEqual([{ factionId: "WorldEaters", points: 13194 }]);
  });

  it("returns an empty array for a missing entry", () => {
    expect(topFactionStandings(null)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildFactionLeaderboard,
  findActivePhase,
  mergeSideLeaderboard,
  pickReferenceScore,
  readLeaderboard,
  resolveMyFactionId,
} from "./fetch-crusade-data";

// Points taken from a real captured GET_LEADERBOARD_2 response (planet_041, crusadePlayer
// "_against" leaderboard) - the player (myRank 53) doesn't place in the top 25 shown here,
// which is the interesting edge case: their score should still sort correctly below all four
// benchmarks, not just get appended at the end.
const realAgainstEntry = {
  numParticipants: 1858,
  myRank: 53,
  myPoints: 9319,
  topEntries: [
    { position: 0, points: 18227 },
    { position: 4, points: 13946 },
    { position: 9, points: 13194 },
    { position: 24, points: 11487 },
    { position: 12, points: 12475 }, // an in-between entry that isn't a benchmark rank
  ],
  localEntries: [
    { position: 51, points: 9446, participantId: "d1b3b23e-659f-4788-ba14-b39db596fe3f", factionId: "WorldEaters" },
    { position: 52, points: 9382, participantId: "909534ea-3995-401a-b44a-f5453ac20e89", factionId: "ThousandSons" },
    { position: 53, points: 9319, participantId: "a4f01b7c-bfd5-431b-aa9c-9e22eb00e6fa", factionId: "WorldEaters" },
    { position: 54, points: 9290, participantId: "897633a4-28b6-44a1-8fe9-bee0756c7749", factionId: "Necrons" },
  ],
};

const noEntry = null;

describe("mergeSideLeaderboard", () => {
  it("picks whichever side actually has a myRank, and extracts #1/#5/#10/#25 benchmarks", () => {
    const result = mergeSideLeaderboard(noEntry, realAgainstEntry, "Against");
    expect(result).toEqual({
      numParticipants: 1858,
      myRank: 53,
      myPoints: 9319,
      benchmarks: [
        { rank: 1, points: 18227 },
        { rank: 5, points: 13946 },
        { rank: 10, points: 13194 },
        { rank: 25, points: 11487 },
      ],
      referenceScore: { rank: 25, points: 11487 }, // 1858 participants: top-10% rank (186) isn't visible, falls back to #25
    });
  });

  it("prefers the for side when both sides are present with a myRank", () => {
    const forEntry = { ...realAgainstEntry, myRank: 7, myPoints: 20000 };
    const result = mergeSideLeaderboard(forEntry, realAgainstEntry, "Against");
    expect(result?.myRank).toBe(7);
  });

  it("only includes benchmarks that actually exist in topEntries (fewer than 25 participants)", () => {
    const small = {
      numParticipants: 8,
      myRank: 3,
      myPoints: 500,
      topEntries: [
        { position: 0, points: 900 },
        { position: 4, points: 400 },
      ],
      localEntries: [],
    };
    const result = mergeSideLeaderboard(small, noEntry, "For");
    expect(result?.benchmarks).toEqual([
      { rank: 1, points: 900 },
      { rank: 5, points: 400 },
    ]);
  });

  describe("when the player has no personal rank on either side", () => {
    const noRank = { numParticipants: 100, myRank: null, myPoints: null, topEntries: [], localEntries: [] };

    it("falls back to the chosenSide's breakpoints (myRank null, benchmarks still present)", () => {
      const forSide = { ...noRank, numParticipants: 200, topEntries: [{ position: 0, points: 5000 }] };
      const result = mergeSideLeaderboard(forSide, noRank, "For");
      expect(result).toEqual({
        numParticipants: 200,
        myRank: null,
        myPoints: null,
        benchmarks: [{ rank: 1, points: 5000 }],
        referenceScore: null, // top-10% rank (20) isn't in topEntries in this fixture
      });
    });

    it("matches chosenSide case-insensitively", () => {
      const againstSide = { ...noRank, numParticipants: 300, topEntries: [{ position: 0, points: 9000 }] };
      const result = mergeSideLeaderboard(noRank, againstSide, "against");
      expect(result?.numParticipants).toBe(300);
    });

    it("returns null when even the chosenSide has no leaderboard entry at all", () => {
      expect(mergeSideLeaderboard(noRank, noEntry, "Against")).toBeNull();
    });
  });
});

describe("resolveMyFactionId", () => {
  it("returns forFactionId when chosenSide is For", () => {
    expect(resolveMyFactionId({ chosenSide: "For", forFactionId: "Custodes", againstFactionId: "WorldEaters" })).toBe("Custodes");
  });

  it("returns againstFactionId when chosenSide is Against", () => {
    expect(resolveMyFactionId({ chosenSide: "Against", forFactionId: "Custodes", againstFactionId: "WorldEaters" })).toBe("WorldEaters");
  });

  it("matches chosenSide case-insensitively", () => {
    expect(resolveMyFactionId({ chosenSide: "against", forFactionId: "Custodes", againstFactionId: "WorldEaters" })).toBe("WorldEaters");
  });
});

describe("buildFactionLeaderboard", () => {
  it("returns rank/participants and benchmarks directly, with no for/against merge", () => {
    const result = buildFactionLeaderboard(realAgainstEntry);
    expect(result).toEqual({
      numParticipants: 1858,
      myRank: 53,
      myPoints: 9319,
      benchmarks: [
        { rank: 1, points: 18227 },
        { rank: 5, points: 13946 },
        { rank: 10, points: 13194 },
        { rank: 25, points: 11487 },
      ],
      referenceScore: { rank: 25, points: 11487 }, // 1858 participants: top-10% rank (186) isn't visible, falls back to #25
    });
  });

  it("still returns benchmarks when there's no personal rank on this planet's faction leaderboard", () => {
    const noRank = {
      numParticipants: 4197,
      myRank: null,
      myPoints: null,
      topEntries: [{ position: 0, points: 58946 }],
      localEntries: [],
    };
    expect(buildFactionLeaderboard(noRank)).toEqual({
      numParticipants: 4197,
      myRank: null,
      myPoints: null,
      benchmarks: [{ rank: 1, points: 58946 }],
      referenceScore: null, // #25 isn't in topEntries in this fixture
    });
  });

  it("returns null for a null entry", () => {
    expect(buildFactionLeaderboard(noEntry)).toBeNull();
  });

  it("falls back to raw top entries when too few participants exist for the standard benchmark ranks", () => {
    // 3 participants - only rank 1 (position 0) would land on a standard benchmark rank, so
    // showing just that one row would throw away positions 1 and 2 even though they're right
    // there in topEntries. All three should show instead.
    const tiny = {
      numParticipants: 3,
      myRank: null,
      myPoints: null,
      topEntries: [
        { position: 0, points: 900 },
        { position: 1, points: 700 },
        { position: 2, points: 500 },
      ],
      localEntries: [],
    };
    expect(buildFactionLeaderboard(tiny)?.benchmarks).toEqual([
      { rank: 1, points: 900 },
      { rank: 2, points: 700 },
      { rank: 3, points: 500 },
    ]);
  });
});

describe("readLeaderboard", () => {
  it("converts the API's 0-based myRank to a 1-based display rank", () => {
    const leaderboards = { "some:id": { numParticipants: 10, myRank: 0, myPoints: 500, topEntries: [], localEntries: [] } };
    expect(readLeaderboard(leaderboards, "some:id", "me")?.myRank).toBe(1);
  });

  it("leaves a null myRank (not ranked, and not present in topEntries/localEntries either) alone", () => {
    const leaderboards = { "some:id": { numParticipants: 10, myRank: null, myPoints: null, topEntries: [], localEntries: [] } };
    expect(readLeaderboard(leaderboards, "some:id", "me")?.myRank).toBeNull();
  });

  it("returns null when the leaderboard id isn't present at all (typo'd id prefix)", () => {
    expect(readLeaderboard({}, "missing:id", "me")).toBeNull();
  });

  it("derives myRank/myPoints from topEntries by participantId when the API omits myRank entirely (player already in the top entries, e.g. rank #1)", () => {
    const leaderboards = {
      "some:id": {
        numParticipants: 10,
        topEntries: [
          { position: 0, points: 7588, participantId: "me" },
          { position: 1, points: 7500, participantId: "someone-else" },
        ],
        localEntries: [],
      },
    };
    const result = readLeaderboard(leaderboards, "some:id", "me");
    expect(result?.myRank).toBe(1);
    expect(result?.myPoints).toBe(7588);
  });

  it("derives myRank/myPoints from localEntries by participantId when myRank is omitted and the player isn't in topEntries", () => {
    const leaderboards = {
      "some:id": {
        numParticipants: 50,
        topEntries: [{ position: 0, points: 9000, participantId: "someone-else" }],
        localEntries: [{ position: 12, points: 3984, participantId: "me" }],
      },
    };
    const result = readLeaderboard(leaderboards, "some:id", "me");
    expect(result?.myRank).toBe(13);
    expect(result?.myPoints).toBe(3984);
  });

  it("prefers the server-supplied myRank over a topEntries participantId match when both are present", () => {
    const leaderboards = {
      "some:id": {
        numParticipants: 10,
        myRank: 4,
        myPoints: 1234,
        topEntries: [{ position: 0, points: 7588, participantId: "me" }],
        localEntries: [],
      },
    };
    const result = readLeaderboard(leaderboards, "some:id", "me");
    expect(result?.myRank).toBe(5);
    expect(result?.myPoints).toBe(1234);
  });
});

describe("findActivePhase", () => {
  it("resolves whichever phase actually brackets now, not just the first CRUSADE entry", () => {
    const realNow = Date.now();
    const phasesAroundNow = [{ phase: "CRUSADE", zone: "zone5", startsOn: realNow - 1000, endsOn: realNow + 1000 }];
    expect(findActivePhase(undefined, phasesAroundNow, undefined)).toEqual({ phase: "CRUSADE", activeZone: 4 });
  });

  it("returns STRUGGLE with a null activeZone (Domination has no zone)", () => {
    const realNow = Date.now();
    const struggleAroundNow = { phase: "STRUGGLE", startsOn: realNow - 1000, endsOn: realNow + 1000 };
    expect(findActivePhase(undefined, [], struggleAroundNow)).toEqual({ phase: "STRUGGLE", activeZone: null });
  });

  it("returns DOWNTIME with a null activeZone", () => {
    const realNow = Date.now();
    const downtimeAroundNow = { phase: "DOWNTIME", startsOn: realNow - 1000, endsOn: realNow + 1000 };
    expect(findActivePhase(downtimeAroundNow, [], undefined)).toEqual({ phase: "DOWNTIME", activeZone: null });
  });

  it("returns null phase when nothing brackets now (all inputs undefined/empty)", () => {
    expect(findActivePhase(undefined, [], undefined)).toEqual({ phase: null, activeZone: null });
  });
});

describe("pickReferenceScore", () => {
  it("uses the top-10% rank's score when it's within the visible top-25 window", () => {
    // 130 participants -> ceil(130 * 0.1) = rank 13 -> topEntries position 12 (0-indexed).
    const entry = { ...realAgainstEntry, numParticipants: 130 };
    expect(pickReferenceScore(entry)).toEqual({ rank: 13, points: 12475 });
  });

  it("falls back to the #25 score when the top-10% rank isn't visible (>250 participants)", () => {
    // 1858 participants -> ceil(1858 * 0.1) = rank 186, far past the top-25 window, so #25
    // (topEntries position 24) is used instead.
    expect(pickReferenceScore(realAgainstEntry)).toEqual({ rank: 25, points: 11487 });
  });

  it("returns null when the target rank isn't present in topEntries", () => {
    const sparse = { numParticipants: 4197, myRank: null, myPoints: null, topEntries: [{ position: 0, points: 58946 }], localEntries: [] };
    expect(pickReferenceScore(sparse)).toBeNull();
  });
});

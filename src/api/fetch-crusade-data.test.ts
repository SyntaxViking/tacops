import { describe, expect, it } from "vitest";
import { buildFactionLeaderboard, findActivePhase, mergeSideLeaderboard, readLeaderboard, resolveMyFactionId } from "./fetch-crusade-data";

// Points taken from a real captured GET_LEADERBOARD_2 response (planet_041, crusadePlayer
// "_against" leaderboard) - the player (myRank 53) doesn't place in the top 25 shown here, which
// is the interesting edge case for the expanded view's "rank +/-2" window (localEntries is where
// that comes from once the player falls outside topEntries). #13 (position 12) isn't one of the
// #1/#5/#10/#25 benchmark ranks, but shows up in the expanded view's full topEntries list.
const realAgainstEntry = {
  numParticipants: 1858,
  myRank: 53,
  myPoints: 9319,
  topEntries: [
    { position: 0, points: 18227 },
    { position: 4, points: 13946 },
    { position: 9, points: 13194 },
    { position: 24, points: 11487 },
    { position: 12, points: 12475 },
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
      // Expanded view: the full topEntries list (ascending by rank, #13 included even though it's
      // not a benchmark rank) plus the rank+/-2 window pulled from localEntries (52-55; #51 isn't
      // in the fixture so it's simply not there).
      topEntries: [
        { rank: 1, points: 18227 },
        { rank: 5, points: 13946 },
        { rank: 10, points: 13194 },
        { rank: 13, points: 12475 },
        { rank: 25, points: 11487 },
      ],
      nearMe: [
        { rank: 52, points: 9446 },
        { rank: 53, points: 9382 },
        { rank: 54, points: 9319 },
        { rank: 55, points: 9290 },
      ],
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

    it("falls back to the chosenSide's breakpoints (myRank null, benchmarks still present, no nearMe since there's no rank to center it on)", () => {
      const forSide = { ...noRank, numParticipants: 200, topEntries: [{ position: 0, points: 5000 }] };
      const result = mergeSideLeaderboard(forSide, noRank, "For");
      expect(result).toEqual({
        numParticipants: 200,
        myRank: null,
        myPoints: null,
        benchmarks: [{ rank: 1, points: 5000 }],
        topEntries: [{ rank: 1, points: 5000 }],
        nearMe: [],
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
      topEntries: [
        { rank: 1, points: 18227 },
        { rank: 5, points: 13946 },
        { rank: 10, points: 13194 },
        { rank: 13, points: 12475 },
        { rank: 25, points: 11487 },
      ],
      nearMe: [
        { rank: 52, points: 9446 },
        { rank: 53, points: 9382 },
        { rank: 54, points: 9319 },
        { rank: 55, points: 9290 },
      ],
    });
  });

  it("nearMe stays within +/-2 of myRank even when localEntries covers a wider window", () => {
    const wideWindow = {
      numParticipants: 500,
      myRank: 40,
      myPoints: 1000,
      topEntries: [],
      localEntries: [
        { position: 36, points: 1400 }, // rank 37 - outside the +/-2 window (38-42)
        { position: 38, points: 1200 }, // rank 39
        { position: 39, points: 1100 }, // rank 40 (me)
        { position: 40, points: 1000 }, // rank 41
        { position: 43, points: 800 }, // rank 44 - outside the window
      ],
    };
    expect(buildFactionLeaderboard(wideWindow)?.nearMe).toEqual([
      { rank: 39, points: 1200 },
      { rank: 40, points: 1100 },
      { rank: 41, points: 1000 },
    ]);
  });

  it("still returns benchmarks (and no nearMe) when there's no personal rank on this planet's faction leaderboard", () => {
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
      topEntries: [{ rank: 1, points: 58946 }],
      nearMe: [],
    });
  });

  it("returns null for a null entry", () => {
    expect(buildFactionLeaderboard(noEntry)).toBeNull();
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

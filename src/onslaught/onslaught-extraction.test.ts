import { describe, expect, it } from "vitest";
import { extractOnslaughtBoards } from "./onslaught-extraction";

function heroWithTracking(tracking: any) {
  return { progress: { onslaught: { progressTracking: tracking } } };
}

describe("extractOnslaughtBoards", () => {
  it("extracts and sorts each alliance's tiers by tier number", () => {
    const hero = heroWithTracking({
      Imperial: {
        battles: [
          { tier: 9, board: { boardId: "Waves_04" } },
          { tier: 3, board: { boardId: "Waves_01" } },
        ],
      },
      Chaos: { battles: [{ tier: 20, board: { boardId: "Waves_04" } }] },
      Xenos: { battles: [{ tier: 20, board: { boardId: "Waves_22" } }] },
    });

    const result = extractOnslaughtBoards(hero);

    expect(result.Imperial.map((e) => e.tier)).toEqual([3, 9]);
    expect(result.Imperial.map((e) => e.boardId)).toEqual(["Waves_01", "Waves_04"]);
    expect(result.Chaos).toEqual([{ tier: 20, boardId: "Waves_04", isChallenge: false }]);
    expect(result.Xenos).toEqual([{ tier: 20, boardId: "Waves_22", isChallenge: false }]);
  });

  it("confirms the same tier can map to different boards across alliances", () => {
    const hero = heroWithTracking({
      Imperial: { battles: [{ tier: 20, board: { boardId: "Waves_20" } }] },
      Chaos: { battles: [{ tier: 20, board: { boardId: "Waves_04" } }] },
      Xenos: { battles: [{ tier: 20, board: { boardId: "Waves_04" } }] },
    });

    const result = extractOnslaughtBoards(hero);

    expect(result.Imperial[0].boardId).toBe("Waves_20");
    expect(result.Chaos[0].boardId).toBe("Waves_04");
  });

  it("drops entries missing a tier or boardId instead of throwing", () => {
    const hero = heroWithTracking({
      Imperial: {
        battles: [
          { tier: 3, board: { boardId: "Waves_01" } },
          { tier: 6 }, // no board at all
          { board: { boardId: "Waves_02" } }, // no tier
        ],
      },
    });

    const result = extractOnslaughtBoards(hero);

    // tier 3 ends up alone here (its would-be siblings were dropped above as malformed, not
    // genuinely absent from the player's progress) - still correctly reads as a collapsed
    // challenge per the isChallenge rule, since the function has no way to tell the two apart.
    expect(result.Imperial).toEqual([{ tier: 3, boardId: "Waves_01", isChallenge: true }]);
  });

  it("returns an empty array per alliance when progressTracking is entirely absent", () => {
    const result = extractOnslaughtBoards({});

    expect(result).toEqual({ Imperial: [], Chaos: [], Xenos: [] });
  });

  it("returns an empty array for an alliance missing from progressTracking", () => {
    const hero = heroWithTracking({
      Imperial: { battles: [{ tier: 3, board: { boardId: "Waves_01" } }] },
    });

    const result = extractOnslaughtBoards(hero);

    expect(result.Chaos).toEqual([]);
    expect(result.Xenos).toEqual([]);
  });

  it("tolerates a null hero", () => {
    expect(extractOnslaughtBoards(null)).toEqual({ Imperial: [], Chaos: [], Xenos: [] });
  });

  it("flags a boundary tier as a challenge once its 1/2 siblings have collapsed away", () => {
    const hero = heroWithTracking({
      Imperial: { battles: [{ tier: 3, board: { boardId: "Waves_01" } }] },
    });

    const result = extractOnslaughtBoards(hero);

    expect(result.Imperial).toEqual([{ tier: 3, boardId: "Waves_01", isChallenge: true }]);
  });

  it("does not flag a boundary tier as a challenge while its 1/2 siblings are still present", () => {
    const hero = heroWithTracking({
      Imperial: {
        battles: [
          { tier: 13, board: { boardId: "Waves_08" } },
          { tier: 14, board: { boardId: "Waves_06" } },
          { tier: 15, board: { boardId: "Waves_09" } },
        ],
      },
    });

    const result = extractOnslaughtBoards(hero);

    expect(result.Imperial).toEqual([
      { tier: 13, boardId: "Waves_08", isChallenge: false },
      { tier: 14, boardId: "Waves_06", isChallenge: false },
      { tier: 15, boardId: "Waves_09", isChallenge: false },
    ]);
  });

  it("never flags a 1 or 2 position as a challenge, even if somehow present without its boundary sibling", () => {
    const hero = heroWithTracking({
      Imperial: { battles: [{ tier: 13, board: { boardId: "Waves_08" } }] },
    });

    const result = extractOnslaughtBoards(hero);

    expect(result.Imperial).toEqual([{ tier: 13, boardId: "Waves_08", isChallenge: false }]);
  });

  it("matches the real capture: Stone/Iron/Bronze/Silver collapsed, Gold/Diamond/Adamantine still in progress", () => {
    const hero = heroWithTracking({
      Imperial: {
        battles: [
          { tier: 3, board: { boardId: "Waves_01" } },
          { tier: 6, board: { boardId: "Waves_02" } },
          { tier: 9, board: { boardId: "Waves_03" } },
          { tier: 12, board: { boardId: "Waves_04" } },
          { tier: 13, board: { boardId: "Waves_05" } },
          { tier: 14, board: { boardId: "Waves_06" } },
          { tier: 15, board: { boardId: "Waves_07" } },
          { tier: 16, board: { boardId: "Waves_08" } },
          { tier: 17, board: { boardId: "Waves_09" } },
          { tier: 18, board: { boardId: "Waves_10" } },
          { tier: 19, board: { boardId: "Waves_11" } },
          { tier: 20, board: { boardId: "Waves_12" } },
          { tier: 21, board: { boardId: "Waves_13" } },
        ],
      },
    });

    const result = extractOnslaughtBoards(hero);
    const challengeTiers = result.Imperial.filter((e) => e.isChallenge).map((e) => e.tier);
    const nonChallengeTiers = result.Imperial.filter((e) => !e.isChallenge).map((e) => e.tier);

    expect(challengeTiers).toEqual([3, 6, 9, 12]);
    expect(nonChallengeTiers).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });
});

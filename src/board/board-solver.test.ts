import solver from "javascript-lp-solver";
import { describe, expect, it, vi } from "vitest";
import {
  classifyDispatchedCharacters,
  findMinimalRequiredSubset,
  rarityWeights,
  solveBoardAssignment,
  solveGreedyFallback,
  type GroupRequirement,
  type RosterCharacter,
} from "./board-solver";
import { Rank } from "../rank/rank.enum";
import { Rarity } from "../rarity/rarity.enum";
import type { CharacterProfile } from "../characters/character-profile";
import type { ExpeditionBoardEntry, RawUnit } from "../api/types";

describe("findMinimalRequiredSubset", () => {
  it("excludes a character whose only objective is already covered by someone else", () => {
    // Reported scenario: trait:parry, faction:black templars (x2), damage:bolter, damage:flame.
    // Helbrecht alone can satisfy parry; Helbrecht+Vindicta are the only two black templars among
    // the assigned set (count 2, so both are needed); either Helbrecht or Isabella can cover
    // bolter, but Helbrecht already does via the other groups, so Isabella shouldn't be required;
    // only Godswyl can cover flame. Mephiston is eligible for nothing and should stay optional.
    const assignedIds = ["helbrecht", "godswyl", "isabella", "vindicta", "mephiston"];
    const groupRequirements: GroupRequirement[] = [
      { key: "Trait::Parry", count: 1, eligibleAssignedIds: ["helbrecht"] },
      { key: "Faction::BlackTemplars", count: 2, eligibleAssignedIds: ["helbrecht", "godswyl"] },
      { key: "DamageType::Bolter", count: 1, eligibleAssignedIds: ["helbrecht", "isabella"] },
      { key: "DamageType::Flame", count: 1, eligibleAssignedIds: ["vindicta"] },
    ];

    const required = findMinimalRequiredSubset(assignedIds, groupRequirements);

    expect(required).toEqual(new Set(["helbrecht", "vindicta", "godswyl"]));
  });

  it("requires everyone when there's no overlap between groups", () => {
    const assignedIds = ["a", "b", "c"];
    const groupRequirements: GroupRequirement[] = [
      { key: "g1", count: 1, eligibleAssignedIds: ["a"] },
      { key: "g2", count: 1, eligibleAssignedIds: ["b"] },
      { key: "g3", count: 1, eligibleAssignedIds: ["c"] },
    ];

    const required = findMinimalRequiredSubset(assignedIds, groupRequirements);

    expect(required).toEqual(new Set(["a", "b", "c"]));
  });

  it("requires no one when there are no objective groups", () => {
    const assignedIds = ["a", "b", "c"];

    const required = findMinimalRequiredSubset(assignedIds, []);

    expect(required).toEqual(new Set());
  });
});

function profile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    name: "Test",
    damageProfiles: [],
    traits: [],
    alliance: "Imperial",
    faction: "Ultramarines",
    hasRangedAttack: false,
    ...overrides,
  };
}

function character(id: string, overrides: Partial<RosterCharacter> = {}): RosterCharacter {
  return {
    id,
    rank: Rank.Gold1,
    rarity: Rarity.Epic,
    xpLevel: 0,
    power: null,
    profile: profile(),
    isFavorited: false,
    isAntiFavorited: false,
    ...overrides,
  };
}

function board(overrides: Partial<ExpeditionBoardEntry> = {}): ExpeditionBoardEntry {
  return {
    expeditionId: overrides.expeditionId ?? "exp",
    id: "op",
    category: "all_vanguard",
    rarity: "Common",
    participants: 1,
    duration: 3600,
    bonusObjectives: [],
    baseRewards: [],
    bonusRewards: [],
    status: "Available",
    ...overrides,
  };
}

describe("solveGreedyFallback", () => {
  it("gives higher-rarity boards first pick of a contested character", () => {
    // Only "flyer" satisfies Trait:Flying and is rank/rarity-eligible for both boards; "filler" is
    // only eligible for the Common board. Boards are processed mythic-first, so the Mythic board
    // should claim "flyer" for its bonus, leaving the Common board to fall back to a plain fill.
    const flyer = character("flyer", {
      rank: Rank.Adamantine2,
      rarity: Rarity.Mythic,
      profile: profile({ traits: ["Flying"] }),
    });
    const filler = character("filler", { rank: Rank.Iron1, rarity: Rarity.Common });
    const objectives = [{ objectiveType: "Trait", objectiveTarget: "Flying" }];
    const mythicBoard = board({ expeditionId: "mythic", rarity: "Mythic", bonusObjectives: objectives });
    const commonBoard = board({ expeditionId: "common", rarity: "Common", bonusObjectives: objectives });

    const result = solveGreedyFallback([commonBoard, mythicBoard], [flyer, filler]);

    const mythicSolution = result.get("mythic")!;
    expect(mythicSolution.bonusCompleted).toBe(true);
    expect(mythicSolution.requiredCharacterIds).toEqual(["flyer"]);

    const commonSolution = result.get("common")!;
    expect(commonSolution.bonusCompleted).toBe(false);
    expect(commonSolution.optionalCharacterIds).toEqual(["filler"]);
    expect([...commonSolution.requiredCharacterIds, ...commonSolution.optionalCharacterIds]).not.toContain("flyer");
  });

  it("credits one character for covering two different objectives in a single pick", () => {
    const duo = character("duo", { profile: profile({ traits: ["Flying"], damageProfiles: ["Bolter"] }) });
    const singleBoard = board({
      bonusObjectives: [
        { objectiveType: "Trait", objectiveTarget: "Flying" },
        { objectiveType: "DamageType", objectiveTarget: "Bolter" },
      ],
    });

    const result = solveGreedyFallback([singleBoard], [duo]);

    const solution = result.get("exp")!;
    expect(solution.bonusCompleted).toBe(true);
    expect(solution.requiredCharacterIds).toEqual(["duo"]);
    expect(solution.optionalCharacterIds).toEqual([]);
  });

  it("displays requiredCharacterIds sorted by power descending, same as optionalCharacterIds", () => {
    // Two non-overlapping objectives, each coverable by only one candidate, so both end up
    // required - the lower-power one is discovered first (board-building order), which would
    // leave it first in an unsorted result; the DISPLAYED order should still be power descending.
    const lowPowerFlyer = character("lowPowerFlyer", { power: 10, profile: profile({ traits: ["Flying"] }) });
    const highPowerBolter = character("highPowerBolter", { power: 9999, profile: profile({ damageProfiles: ["Bolter"] }) });
    const twoObjectiveBoard = board({
      participants: 2,
      bonusObjectives: [
        { objectiveType: "Trait", objectiveTarget: "Flying" },
        { objectiveType: "DamageType", objectiveTarget: "Bolter" },
      ],
    });

    const result = solveGreedyFallback([twoObjectiveBoard], [lowPowerFlyer, highPowerBolter]);

    const solution = result.get("exp")!;
    expect(solution.bonusCompleted).toBe(true);
    expect(solution.requiredCharacterIds).toEqual(["highPowerBolter", "lowPowerFlyer"]);
  });

  it("falls back to a rank fill that prefers an uncapped character over a higher-rank capped one", () => {
    const cappedHigh = character("cappedHigh", { rank: Rank.Adamantine2, rarity: Rarity.Mythic, xpLevel: 60 }); // xpLevelCap[Mythic] = 60
    const uncappedLow = character("uncappedLow", { rank: Rank.Iron1, rarity: Rarity.Common, xpLevel: 0 });
    const unsolvableBoard = board({ bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }] });

    const result = solveGreedyFallback([unsolvableBoard], [cappedHigh, uncappedLow]);

    const solution = result.get("exp")!;
    expect(solution.bonusCompleted).toBe(false);
    expect(solution.run).toBe(true);
    expect(solution.optionalCharacterIds).toEqual(["uncappedLow"]);
  });

  it("still uses a capped character when there aren't enough uncapped bodies to fill the slots", () => {
    const cappedHigh = character("cappedHigh", { rank: Rank.Adamantine2, rarity: Rarity.Mythic, xpLevel: 60 });
    const uncappedLow = character("uncappedLow", { rank: Rank.Iron1, rarity: Rarity.Common, xpLevel: 0 });
    const unsolvableBoard = board({
      participants: 2,
      bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }],
    });

    const result = solveGreedyFallback([unsolvableBoard], [cappedHigh, uncappedLow]);

    const solution = result.get("exp")!;
    expect(solution.run).toBe(true);
    expect(new Set(solution.optionalCharacterIds)).toEqual(new Set(["cappedHigh", "uncappedLow"]));
  });

  it("marks a board unable to run when too few eligible characters remain for its slots", () => {
    const eligible = character("eligible", { rank: Rank.Adamantine2, rarity: Rarity.Mythic });
    const tooWeak1 = character("tooWeak1", { rank: Rank.Iron1, rarity: Rarity.Common });
    const tooWeak2 = character("tooWeak2", { rank: Rank.Iron1, rarity: Rarity.Common });
    const mythicBoard = board({ rarity: "Mythic", participants: 3 });

    const result = solveGreedyFallback([mythicBoard], [eligible, tooWeak1, tooWeak2]);

    expect(result.get("exp")!.run).toBe(false);
  });

  it("leaves a redundant padding character optional rather than required", () => {
    const solver = character("solver", { profile: profile({ traits: ["Flying"] }) });
    const filler = character("filler");
    const twoSlotBoard = board({ participants: 2, bonusObjectives: [{ objectiveType: "Trait", objectiveTarget: "Flying" }] });

    const result = solveGreedyFallback([twoSlotBoard], [solver, filler]);

    const solution = result.get("exp")!;
    expect(solution.requiredCharacterIds).toEqual(["solver"]);
    expect(solution.optionalCharacterIds).toEqual(["filler"]);
  });

  it("fills with the higher-power character over a higher-rank one, once both are uncapped", () => {
    const highRankLowPower = character("highRankLowPower", { rank: Rank.Adamantine2, power: 100 });
    const lowRankHighPower = character("lowRankHighPower", { rank: Rank.Iron1, power: 9999 });
    const unsolvableBoard = board({ bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }] });

    const result = solveGreedyFallback([unsolvableBoard], [highRankLowPower, lowRankHighPower]);

    expect(result.get("exp")!.optionalCharacterIds).toEqual(["lowRankHighPower"]);
  });

  it("displays optionalCharacterIds sorted by power descending, even when fill preference picked them in the opposite order", () => {
    // fillComparator would place uncappedLow before cappedHigh (uncapped-first tiebreak), but the
    // DISPLAYED order should be a plain power sort, independent of why each character got picked.
    const cappedHigh = character("cappedHigh", { rarity: Rarity.Mythic, xpLevel: 60, power: 9999 });
    const uncappedLow = character("uncappedLow", { rarity: Rarity.Common, xpLevel: 0, power: 1 });
    const twoSlotBoard = board({ participants: 2 });

    const result = solveGreedyFallback([twoSlotBoard], [cappedHigh, uncappedLow]);

    expect(result.get("exp")!.optionalCharacterIds).toEqual(["cappedHigh", "uncappedLow"]);
  });

  it("prefers a favorited character over a higher-power neutral one when padding", () => {
    const favoritedLow = character("favoritedLow", { power: 100, isFavorited: true });
    const neutralHigh = character("neutralHigh", { power: 9999 });
    const unsolvableBoard = board({ bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }] });

    const result = solveGreedyFallback([unsolvableBoard], [favoritedLow, neutralHigh]);

    expect(result.get("exp")!.optionalCharacterIds).toEqual(["favoritedLow"]);
  });

  it("avoids an anti-favorited character in favor of an uncapped, non-anti-favorited alternative - same as XP-capped avoidance", () => {
    const antiFavoritedHigh = character("antiFavoritedHigh", { rank: Rank.Adamantine2, power: 9999, isAntiFavorited: true });
    const neutralLow = character("neutralLow", { rank: Rank.Iron1, power: 1 });
    const unsolvableBoard = board({ bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }] });

    const result = solveGreedyFallback([unsolvableBoard], [antiFavoritedHigh, neutralLow]);

    expect(result.get("exp")!.optionalCharacterIds).toEqual(["neutralLow"]);
  });

  it("still uses an anti-favorited character when there's no other eligible body", () => {
    const antiFavoritedOnly = character("antiFavoritedOnly", { isAntiFavorited: true });
    const unsolvableBoard = board({ bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }] });

    const result = solveGreedyFallback([unsolvableBoard], [antiFavoritedOnly]);

    expect(result.get("exp")!.run).toBe(true);
    expect(result.get("exp")!.optionalCharacterIds).toEqual(["antiFavoritedOnly"]);
  });

  it("prefers an XP-capped character over an anti-favorited one, since avoiding anti-favorites outranks XP", () => {
    // Same order as the LP's tail passes: anti-favorites are avoided first, then favorites are
    // preferred, and XP only decides among what's left - so a capped neutral beats an uncapped
    // anti-favorite even though the anti-favorite could still earn XP.
    const cappedHighPower = character("cappedHighPower", { rarity: Rarity.Mythic, xpLevel: 60, power: 9999 });
    const antiFavoritedLowPower = character("antiFavoritedLowPower", { power: 1, isAntiFavorited: true });
    const unsolvableBoard = board({ bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }] });

    const result = solveGreedyFallback([unsolvableBoard], [cappedHighPower, antiFavoritedLowPower]);

    expect(result.get("exp")!.optionalCharacterIds).toEqual(["cappedHighPower"]);
  });

  it("prefers a favorited XP-capped character over an uncapped neutral one, since favorites outrank XP", () => {
    const favoritedCapped = character("favoritedCapped", { rarity: Rarity.Mythic, xpLevel: 60, power: 100, isFavorited: true });
    const neutralGrowing = character("neutralGrowing", { power: 9999 });
    const unsolvableBoard = board({ bonusObjectives: [{ objectiveType: "Faction", objectiveTarget: "Necrons" }] });

    const result = solveGreedyFallback([unsolvableBoard], [favoritedCapped, neutralGrowing]);

    expect(result.get("exp")!.optionalCharacterIds).toEqual(["favoritedCapped"]);
  });
});

describe("solveBoardAssignment", () => {
  it("still fills the slot when nothing distinguishes the candidates", () => {
    // A single Common-rarity slot with no bonus objectives and no preferences: every pass ties
    // between the two candidates, so either may take the slot - but it must be filled.
    const weakHero: RawUnit = { id: "ultraTigurius", power: 100 };
    const strongHero: RawUnit = { id: "ultraEliminatorSgt", power: 9999 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard" });

    const { assignment, status } = solveBoardAssignment(
      [openBoard],
      [weakHero, strongHero],
      ["rarity", "intel", "crusadeBomb", "crusadeNpc"],
    );

    expect(status).toBe("ok");
    const solution = assignment.get("exp")!;
    expect(solution.run).toBe(true);
    expect(solution.optionalCharacterIds).toHaveLength(1);
  });

  it("prefers the character who earns more XP when nothing else distinguishes them", () => {
    const weak: RawUnit = { id: "ultraTigurius", power: 100 };
    const strong: RawUnit = { id: "ultraEliminatorSgt", power: 9999 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard" });

    const { assignment } = solveBoardAssignment([openBoard], [weak, strong], ["rarity", "intel", "crusadeBomb", "crusadeNpc"]);

    expect(assignment.get("exp")!.optionalCharacterIds).toEqual(["ultraEliminatorSgt"]);
  });

  it("never picks an XP-capped character over one that can still earn XP", () => {
    const capped: RawUnit = { id: "ultraEliminatorSgt", power: 9999, progressionIndex: 19, xpLevel: 60, rank: Rank.Adamantine2 - 1 };
    const growing: RawUnit = { id: "ultraTigurius", power: 100, progressionIndex: 19, xpLevel: 10, rank: Rank.Adamantine2 - 1 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard" });

    const { assignment } = solveBoardAssignment([openBoard], [capped, growing], ["rarity", "intel", "crusadeBomb", "crusadeNpc"]);

    expect(assignment.get("exp")!.optionalCharacterIds).toEqual(["ultraTigurius"]);
  });

  describe("partial results", () => {
    const priority: Parameters<typeof solveBoardAssignment>[2] = ["rarity", "intel", "crusadeBomb", "crusadeNpc"];
    const roster: RawUnit[] = [{ id: "ultraTigurius", power: 100 }, { id: "ultraEliminatorSgt", power: 5000 }];
    const operation = () => board({ rarity: "Common", category: "all_vanguard" });

    // Makes every solver.Solve() call after the first `allowed` ones come back infeasible,
    // standing in for a pass that times out.
    const failAfter = (allowed: number) => {
      const realSolve = solver.Solve.bind(solver);
      let calls = 0;
      return vi.spyOn(solver, "Solve").mockImplementation((model) => (++calls <= allowed ? realSolve(model) : ({ feasible: false } as never)));
    };

    it("reports each pass that still has later passes as a checkpoint, with what's left to optimize", () => {
      const checkpoints: string[][] = [];
      const result = solveBoardAssignment([operation()], roster, priority, new Set(), new Set(), false, (assignment, unfinished) => {
        expect(assignment.get("exp")!.run).toBe(true);
        checkpoints.push(unfinished);
      });

      expect(result.status).toBe("ok");
      // Only the rarity and XP passes have anything to optimize here (no rewards, no preferences),
      // so the single checkpoint is after rarity, with XP still to go.
      expect(checkpoints).toEqual([["XP gain"]]);
    });

    it("returns the last completed pass as a partial result when a later pass fails", () => {
      const spy = failAfter(1); // the rarity pass completes, the XP pass doesn't
      try {
        const result = solveBoardAssignment([operation()], roster, priority);

        expect(result.status).toBe("partial");
        expect(result.unfinishedPasses).toEqual(["XP gain"]);
        expect(result.assignment.get("exp")!.run).toBe(true);
        expect(result.assignment.get("exp")!.optionalCharacterIds).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("reports failure with an empty assignment when not even the first pass completes", () => {
      const spy = failAfter(0);
      try {
        const result = solveBoardAssignment([operation()], roster, priority);

        expect(result.status).toBe("failed");
        expect(result.assignment.size).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("rarity priority", () => {
    // Mythic-eligible units: progressionIndex 19 is Mythic; intToRank adds 1 to the raw rank.
    const mythicUnit = (id: string): RawUnit => ({ id, power: 100, progressionIndex: 19, rank: Rank.Adamantine2 - 1 });
    const priority: Parameters<typeof solveBoardAssignment>[2] = ["rarity", "intel", "crusadeBomb", "crusadeNpc"];
    const mythicOp = board({ expeditionId: "mythic", rarity: "Mythic", participants: 2 });
    const legendaryA = board({ expeditionId: "legendaryA", rarity: "Legendary", participants: 1 });
    const legendaryB = board({ expeditionId: "legendaryB", rarity: "Legendary", participants: 1 });

    it("runs the one Mythic operation over two Legendary ones when the roster can only cover one option", () => {
      // Two characters: either both go to the Mythic operation (2 slots) or one each to the two
      // Legendary ones. Summing rarity numbers (Mythic 5 vs Legendary 4 + 4) would pick the
      // Legendaries; strict rarity order must pick the Mythic however many Legendaries it displaces.
      const roster = [mythicUnit("ultraTigurius"), mythicUnit("ultraEliminatorSgt")];

      const { assignment } = solveBoardAssignment([legendaryA, legendaryB, mythicOp], roster, priority);

      expect(assignment.get("mythic")!.run).toBe(true);
      expect(assignment.get("legendaryA")!.run).toBe(false);
      expect(assignment.get("legendaryB")!.run).toBe(false);
    });

    it("still runs the lower-rarity operations the higher one doesn't need characters for", () => {
      const roster = [mythicUnit("ultraTigurius"), mythicUnit("ultraEliminatorSgt"), mythicUnit("ultraTitus")];

      const { assignment } = solveBoardAssignment([legendaryA, legendaryB, mythicOp], roster, priority);

      expect(assignment.get("mythic")!.run).toBe(true);
      expect([assignment.get("legendaryA")!.run, assignment.get("legendaryB")!.run].filter(Boolean)).toHaveLength(1);
    });
  });

  it("skips a tiebreak pass whose objective is zero for everyone instead of running it", () => {
    // With nobody favorited, favoriteScore is 0 for every variable. Maximizing a constant is a
    // degenerate LP that can hang the library outright, so runPasses must not run it.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const priority: Parameters<typeof solveBoardAssignment>[2] = ["rarity", "intel", "crusadeBomb", "crusadeNpc"];
      const result = solveBoardAssignment([board()], [{ id: "deathRotbone", power: 100 }], priority);

      const messages = log.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes('pass "favoriteScore"') && m.includes("skipped"))).toBe(true);
      expect(messages.some((m) => m.includes('pass "favoriteScore"') && m.includes("feasible="))).toBe(false);
      expect(result.assignment.get("exp")!.run).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("orders a board's optionalCharacterIds by power descending", () => {
    const low: RawUnit = { id: "ultraTigurius", power: 50 };
    const high: RawUnit = { id: "ultraInceptorSgt", power: 5000 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard", participants: 2 });

    const { assignment } = solveBoardAssignment(
      [openBoard],
      [low, high],
      ["rarity", "intel", "crusadeBomb", "crusadeNpc"],
    );

    expect(assignment.get("exp")!.optionalCharacterIds).toEqual(["ultraInceptorSgt", "ultraTigurius"]);
  });

  describe("anti-favorites", () => {
    const priority: Parameters<typeof solveBoardAssignment>[2] = ["rarity", "intel", "crusadeBomb", "crusadeNpc"];
    const openBoard = () => board({ rarity: "Common", category: "all_vanguard" });

    it("avoids an anti-favorited character when another one can fill the slot", () => {
      const { assignment } = solveBoardAssignment(
        [openBoard()],
        [{ id: "ultraTigurius", power: 9999 }, { id: "ultraEliminatorSgt", power: 100 }],
        priority,
        new Set(),
        new Set(["ultraTigurius"]),
      );

      expect(assignment.get("exp")!.optionalCharacterIds).toEqual(["ultraEliminatorSgt"]);
    });

    it("still uses an anti-favorited character when nobody else can fill the slot", () => {
      const { assignment } = solveBoardAssignment(
        [openBoard()],
        [{ id: "ultraTigurius", power: 100 }],
        priority,
        new Set(),
        new Set(["ultraTigurius"]),
      );

      const solution = assignment.get("exp")!;
      expect(solution.run).toBe(true);
      expect(solution.optionalCharacterIds).toEqual(["ultraTigurius"]);
    });
  });

  it("prefers a favorited character over a higher-power one, since favoriteScore outranks xpGain", () => {
    // Both start with xpLevel 0 (estimateXpGain 0 either way), so xpGain ties - only the
    // favoriteScore pass (which runs before xpGain) can decide this.
    const favoritedWeak: RawUnit = { id: "ultraTigurius", power: 100 };
    const neutralStrong: RawUnit = { id: "ultraEliminatorSgt", power: 9999 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard" });

    const { assignment } = solveBoardAssignment(
      [openBoard],
      [favoritedWeak, neutralStrong],
      ["rarity", "intel", "crusadeBomb", "crusadeNpc"],
      new Set(["ultraTigurius"]),
    );

    expect(assignment.get("exp")!.optionalCharacterIds).toEqual(["ultraTigurius"]);
  });

  it("avoids assigning an anti-favorited character when another character can fill the slot, even if the anti-favorited one would earn more XP", () => {
    // Both are uncapped and the anti-favorited one has far more power (so it would win the XP
    // pass) - only the antiFavoriteCount pass, which runs first, can make the weaker one win.
    const antiFavoritedStrong: RawUnit = { id: "ultraEliminatorSgt", power: 9999, xpLevel: 3 };
    const neutralWeak: RawUnit = { id: "ultraTigurius", power: 100, xpLevel: 3 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard" });

    const { assignment } = solveBoardAssignment(
      [openBoard],
      [antiFavoritedStrong, neutralWeak],
      ["rarity", "intel", "crusadeBomb", "crusadeNpc"],
      new Set(),
      new Set(["ultraEliminatorSgt"]),
    );

    expect(assignment.get("exp")!.optionalCharacterIds).toEqual(["ultraTigurius"]);
  });

  it("counts a relic-added damage profile toward a bonus objective the character can't otherwise satisfy", () => {
    // deathRotbone's own kit is Power-only; his Orbs of Decay relic adds Toxic (see
    // equippedRelicDamageProfiles), which is what makes him eligible for a Toxic-damage bonus.
    // A bonus reward is needed so the LP has a reason to complete the bonus at all (it only
    // weights the bonus variable by reward amount).
    const toxicBoard = board({
      bonusObjectives: [{ objectiveType: "DamageType", objectiveTarget: "Toxic" }],
      bonusRewards: ["intel:100"],
    });
    const priority: Parameters<typeof solveBoardAssignment>[2] = ["rarity", "intel", "crusadeBomb", "crusadeNpc"];

    const withRelic: RawUnit = { id: "deathRotbone", power: 100, extraDamageProfiles: ["Toxic"] };
    const withoutRelic: RawUnit = { id: "deathRotbone", power: 100 };

    const relicResult = solveBoardAssignment([toxicBoard], [withRelic], priority).assignment.get("exp")!;
    expect(relicResult.bonusCompleted).toBe(true);
    expect(relicResult.requiredCharacterIds).toEqual(["deathRotbone"]);

    const plainResult = solveBoardAssignment([toxicBoard], [withoutRelic], priority).assignment.get("exp")!;
    expect(plainResult.bonusCompleted).toBe(false);
  });

  it("skips the LP entirely and uses the greedy fallback when skipLp is set", () => {
    // Same shape as the very first test above (a single Common slot, two candidates differing
    // only on power) - skipLp=true should still produce a complete, sensible assignment via
    // solveGreedyFallback, not an empty/failed one, confirming the watchdog's forced-greedy retry
    // (see board-solver.worker.ts/App.tsx) actually reaches a usable result.
    const weakHero: RawUnit = { id: "ultraTigurius", power: 100 };
    const strongHero: RawUnit = { id: "ultraEliminatorSgt", power: 9999 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard" });

    const { assignment, status } = solveBoardAssignment(
      [openBoard],
      [weakHero, strongHero],
      ["rarity", "intel", "crusadeBomb", "crusadeNpc"],
      new Set(),
      new Set(),
      true,
    );

    expect(status).toBe("ok");
    expect(assignment.get("exp")!.run).toBe(true);
  });

  it("excludes a hero with an unrecognized character id from the roster instead of throwing", () => {
    // buildRoster calls getCharacterProfile for every hero passed in - mixing in an id the
    // bundled character data doesn't know about (e.g. a character added to the game since this
    // build's data was last extracted) must not take down the whole solve.
    const knownHero: RawUnit = { id: "ultraTigurius", power: 9999 };
    const unknownHero: RawUnit = { id: "notARealCharacterId", power: 100 };
    const openBoard = board({ rarity: "Common", category: "all_vanguard" });

    const { assignment, status } = solveBoardAssignment(
      [openBoard],
      [knownHero, unknownHero],
      ["rarity", "intel", "crusadeBomb", "crusadeNpc"],
    );

    expect(status).toBe("ok");
    expect(assignment.get("exp")!.optionalCharacterIds).toEqual(["ultraTigurius"]);
  });
});

describe("classifyDispatchedCharacters", () => {
  // Real character ids (getCharacterProfile looks them up in the bundled character-data.json, so
  // these can't be made-up like findMinimalRequiredSubset's own synthetic ids above):
  // ultraTigurius has the Psyker trait; ultraEliminatorSgt's ranged attack is Bolter-pierce.
  const dispatchedBoard = board({
    bonusObjectives: [
      { objectiveType: "Trait", objectiveTarget: "Psyker" },
      { objectiveType: "DamageType", objectiveTarget: "Bolter" },
    ],
    status: "Dispatched",
    units: ["ultraTigurius", "ultraEliminatorSgt", "ultraApothecary"],
  });
  // ultraApothecary (Hero/Healer traits, melee-only) covers neither objective, so it should always
  // land in optionalIds.
  const heroes: RawUnit[] = [
    { id: "ultraTigurius" },
    { id: "ultraEliminatorSgt" },
    { id: "ultraApothecary" },
  ];

  it("requires only the characters actually needed to satisfy the entry's own bonus objectives", () => {
    const result = classifyDispatchedCharacters(dispatchedBoard, heroes);

    expect(result.requiredIds).toEqual(new Set(["ultraTigurius", "ultraEliminatorSgt"]));
    expect(result.optionalIds).toEqual(new Set(["ultraApothecary"]));
  });

  it("treats a non-character dispatched unit (a Machine of War) as always optional", () => {
    const withMow = board({ ...dispatchedBoard, units: ["ultraTigurius", "mow_not_a_real_character"] });

    const result = classifyDispatchedCharacters(withMow, heroes);

    expect(result.requiredIds).toEqual(new Set(["ultraTigurius"]));
    expect(result.optionalIds).toEqual(new Set());
    // Crucially, no attempt is made to profile-lookup the non-character id (that would throw).
  });

  it("requires no one when the entry has no bonus objectives at all", () => {
    const noObjectives = board({ status: "Dispatched", units: ["ultraTigurius", "ultraEliminatorSgt"] });

    const result = classifyDispatchedCharacters(noObjectives, heroes);

    expect(result.requiredIds).toEqual(new Set());
    expect(result.optionalIds).toEqual(new Set(["ultraTigurius", "ultraEliminatorSgt"]));
  });
});

describe("rarityWeights", () => {
  it("makes one operation worth more than every lower-rarity operation together", () => {
    const weights = rarityWeights([
      Rarity.Mythic, Rarity.Mythic, Rarity.Legendary,
      Rarity.Rare, Rarity.Rare, Rarity.Rare, Rarity.Rare,
    ]);

    expect(weights.get(Rarity.Rare)).toBe(1);
    expect(weights.get(Rarity.Legendary)).toBe(5); // 4 Rares (4) + 1
    expect(weights.get(Rarity.Mythic)).toBe(10); // 4 Rares (4) + 1 Legendary (5) + 1
    expect(weights.has(Rarity.Epic)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { computeHeroQuestJars, formatJarStatus } from "./hero-quest-view-model";
import { Rarity } from "../rarity/rarity.enum";

describe("computeHeroQuestJars", () => {
  it("returns 17 rows ordered battle 17 down to 1", () => {
    const jars = computeHeroQuestJars(undefined);

    expect(jars.map((jar) => jar.battleNumber)).toEqual(
      Array.from({ length: 17 }, (_, i) => 17 - i),
    );
  });

  it("treats a missing/empty jar as a fresh reset with nothing won or lost yet", () => {
    const jars = computeHeroQuestJars({ LHE3: {} });

    const battle3 = jars.find((jar) => jar.battleNumber === 3)!;
    expect(battle3.rarity).toBe(Rarity.Common);
    expect(battle3.rewardsReceived).toBe(0);
    expect(battle3.rewardsMissed).toBe(0);
    expect(battle3.rewardsRemaining).toBe(3);
    expect(battle3.battlesRemaining).toBe(4);
  });

  it("computes remaining rewards/battles for a partially-played non-mythic jar", () => {
    const jars = computeHeroQuestJars({ LHE1: { savedRolls: { won: 2, lost: 1 } } });

    const battle1 = jars.find((jar) => jar.battleNumber === 1)!;
    expect(battle1.rewardsReceived).toBe(2);
    expect(battle1.rewardsMissed).toBe(1);
    expect(battle1.rewardsRemaining).toBe(1); // 3 - 2
    expect(battle1.battlesRemaining).toBe(1); // 4 - (2 + 1)
  });

  it("uses the 1-reward/6-battle cycle for the Mythic battle instead of the default 3/4", () => {
    const jars = computeHeroQuestJars({ LHE17: { savedRolls: { won: 1 } } });

    const battle17 = jars.find((jar) => jar.battleNumber === 17)!;
    expect(battle17.rarity).toBe(Rarity.Mythic);
    expect(battle17.rewardsRemaining).toBe(0); // 1 - 1
    expect(battle17.battlesRemaining).toBe(5); // 6 - (1 + 0)
  });
});

describe("formatJarStatus", () => {
  it("shows received, total attempts (received + missed), and battles remaining", () => {
    const jars = computeHeroQuestJars({ LHE1: { savedRolls: { won: 2, lost: 1 } } });
    const battle1 = jars.find((jar) => jar.battleNumber === 1);
    expect(formatJarStatus(battle1)).toBe("2 received from 3 attempts (1 attempts remaining)");
  });

  it("returns null when there's no jar for this battle", () => {
    expect(formatJarStatus(undefined)).toBeNull();
  });
});

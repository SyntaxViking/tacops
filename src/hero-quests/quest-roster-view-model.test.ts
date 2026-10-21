import { describe, expect, it } from "vitest";
import { toRenderableQuestUnit } from "./quest-roster-view-model";
import type { QuestRosterUnit } from "./quest-battle-data";

function unit(overrides: Partial<QuestRosterUnit> = {}): QuestRosterUnit {
  return { unitId: "astarEradicator", rank: 20, starLevel: 14, activeAbilityLevel: 65, passiveAbilityLevel: 65, rarity: 5, ...overrides };
}

describe("toRenderableQuestUnit", () => {
  it("resolves a portrait, halo, rank icon and stars for a known character", () => {
    const result = toRenderableQuestUnit(unit());
    expect(result.portraitUrl).not.toBeNull();
    expect(result.haloFilter).not.toBeNull();
    expect(result.rankIconUrl).not.toBeNull();
    expect(result.starIconUrls.length).toBeGreaterThan(0);
    expect(result.activeAbilityLevel).toBe(65);
    expect(result.passiveAbilityLevel).toBe(65);
  });

  it("falls back to a null portrait instead of throwing for an unmapped unit id", () => {
    const result = toRenderableQuestUnit(unit({ unitId: "notARealCharacterId" }));
    expect(result.portraitUrl).toBeNull();
  });

  it("leaves rank/halo/stars null when a replay didn't record them", () => {
    const result = toRenderableQuestUnit(unit({ rank: null, rarity: null, starLevel: null }));
    expect(result.rankIconUrl).toBeNull();
    expect(result.haloFilter).toBeNull();
    expect(result.starIconUrls).toEqual([]);
  });
});

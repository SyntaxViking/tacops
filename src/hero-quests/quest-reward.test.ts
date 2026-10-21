import { describe, expect, it } from "vitest";
import { parseQuestReward } from "./quest-reward";
import { Rarity } from "../rarity/rarity.enum";

describe("parseQuestReward", () => {
  it("parses an upgrade material's item id, stat, rarity and odds", () => {
    expect(parseQuestReward("upgHpM004%1/6")).toEqual({ kind: "upgrade", item: "upgHpM004", statLabel: "Health", rarity: Rarity.Mythic, odds: "1/6" });
    expect(parseQuestReward("upgArmC002%3/4")).toEqual({ kind: "upgrade", item: "upgArmC002", statLabel: "Armor", rarity: Rarity.Common, odds: "3/4" });
    expect(parseQuestReward("upgDmgR007%3/4")).toEqual({ kind: "upgrade", item: "upgDmgR007", statLabel: "Damage", rarity: Rarity.Rare, odds: "3/4" });
  });

  it("parses character shards, including the mythic variant", () => {
    expect(parseQuestReward("shards_astarEradicator%3/4")).toEqual({ kind: "shard", unitId: "astarEradicator", mythic: false });
    expect(parseQuestReward("mythicShards_astarEradicator%3/4")).toEqual({ kind: "shard", unitId: "astarEradicator", mythic: true });
  });

  it("falls back to the raw item id for anything unrecognized", () => {
    expect(parseQuestReward("somethingElse%3/4")).toEqual({ kind: "unknown", raw: "somethingElse" });
  });

  it("returns null for no reward at all", () => {
    expect(parseQuestReward(null)).toBeNull();
  });
});

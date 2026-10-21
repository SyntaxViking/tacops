import { Rarity } from "../rarity/rarity.enum";

export type QuestReward =
  | { kind: "upgrade"; item: string; statLabel: string; rarity: Rarity; odds: string }
  | { kind: "shard"; unitId: string; mythic: boolean }
  | { kind: "unknown"; raw: string };

const STAT_LABEL: Record<string, string> = { Hp: "Health", Arm: "Armor", Dmg: "Damage" };
const RARITY_LETTER: Record<string, Rarity> = {
  C: Rarity.Common,
  U: Rarity.Uncommon,
  R: Rarity.Rare,
  E: Rarity.Epic,
  L: Rarity.Legendary,
  M: Rarity.Mythic,
};

// A battle's repeatable reward, confirmed against the real GameConfig: "upg<Hp|Arm|Dmg><rarity
// letter><NNN>%<a>/<b>" for upgrade materials, "(shards|mythicShards)_<unitId>" for character
// shards. The %<a>/<b> odds are deliberately not turned into a percentage (the formula isn't
// public) - callers that want to show them do so as the raw fraction.
export function parseQuestReward(chanceOf: string | null): QuestReward | null {
  if (!chanceOf) return null;
  const [item, odds] = chanceOf.split("%");
  const upgrade = item.match(/^upg(Hp|Arm|Dmg)([CURELM])\d+$/);
  if (upgrade) {
    return { kind: "upgrade", item, statLabel: STAT_LABEL[upgrade[1]], rarity: RARITY_LETTER[upgrade[2]], odds: odds ?? "" };
  }
  const shard = item.match(/^(shards|mythicShards)_(\w+)$/);
  if (shard) {
    return { kind: "shard", unitId: shard[2], mythic: shard[1] === "mythicShards" };
  }
  return { kind: "unknown", raw: item };
}

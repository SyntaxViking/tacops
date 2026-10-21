import { characterPortraitUrl } from "../characters/character-portraits";
import { parseQuestReward } from "../hero-quests/quest-reward";
import { upgradeIconLayers } from "../hero-quests/upgrade-icon";
import { Rarity } from "../rarity/rarity.enum";

// Shared by QuestBattleCard and QuestBattleTable - same reward rendering either way, just a
// different surrounding layout.
export function QuestRewardIcon({ chanceOf }: { chanceOf: string | null }) {
  const reward = parseQuestReward(chanceOf);
  if (!reward) return null;
  if (reward.kind === "upgrade") {
    const layers = upgradeIconLayers(reward.item, reward.rarity);
    return (
      <div
        className="relative h-[52px] w-[52px] shrink-0"
        title={`${reward.statLabel} Upgrade (${Rarity[reward.rarity]}) - odds not decoded, shown as the game's own fraction: ${reward.odds}`}
      >
        <img src={layers.background} className="absolute inset-[3px] h-[46px] w-[46px]" />
        <img src={layers.icon} className="absolute inset-[8px] h-9 w-9" />
        <img src={layers.frame} className="absolute inset-0 h-full w-full" />
      </div>
    );
  }
  if (reward.kind === "shard") {
    let portraitUrl: string | null = null;
    try {
      portraitUrl = characterPortraitUrl(reward.unitId);
    } catch {
      portraitUrl = null;
    }
    return (
      <span className="flex items-center gap-1 text-sm" title={chanceOf ?? undefined}>
        {portraitUrl && <img src={portraitUrl} className="h-5 w-5 rounded-full" />}
        {reward.mythic ? "Mythic " : ""}Shards
      </span>
    );
  }
  return (
    <span className="text-sm" title={chanceOf ?? undefined}>
      {reward.raw}
    </span>
  );
}

import { formatJarStatus } from "../hero-quests/hero-quest-view-model";
import { toRenderableQuestUnit } from "../hero-quests/quest-roster-view-model";
import { QuestRewardIcon } from "./QuestRewardIcon";
import { QuestUnitSlot } from "./QuestUnitSlot";
import type { QuestBattle } from "../hero-quests/quest-battle-data";
import type { HeroQuestJar } from "../hero-quests/hero-quest-view-model";

// Same tier colors as the raidman-replay-gallery pipeline's own QUEST_TIERS (build_gallery.py) -
// Common brown through Mythic orange, used for the card's glow border below.
const TIER_COLOR: Record<string, string> = {
  Common: "#8d6e63",
  Uncommon: "#cd7f32",
  Rare: "#c0c0c0",
  Epic: "#ffc107",
  Legendary: "#00e5ff",
  Mythic: "#e8833a",
};

export function QuestBattleCard({ battle, jar }: { battle: QuestBattle; jar: HeroQuestJar | undefined }) {
  const jarStatus = formatJarStatus(jar);
  const tierColor = battle.tierName ? TIER_COLOR[battle.tierName] : undefined;
  return (
    <a
      href={battle.replayUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      style={tierColor ? { borderColor: tierColor, boxShadow: `0 0 10px -3px ${tierColor}` } : undefined}
      className={`flex flex-col gap-2 rounded-lg border bg-white/60 p-3 text-left no-underline dark:bg-white/5 ${
        tierColor ? "" : "border-black/10 dark:border-white/15"
      } ${battle.replayUrl ? "cursor-pointer" : "cursor-default opacity-80"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-inherit">{battle.label}</span>
        <QuestRewardIcon chanceOf={battle.rewardChanceOf} />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {battle.roster.map((unit, i) => (
          <QuestUnitSlot key={`${unit.unitId}-${i}`} unit={toRenderableQuestUnit(unit)} />
        ))}
      </div>
      {jarStatus && <span className="text-xs opacity-60">{jarStatus}</span>}
    </a>
  );
}

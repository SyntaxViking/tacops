import { formatJarStatus } from "../hero-quests/hero-quest-view-model";
import { toRenderableQuestUnit } from "../hero-quests/quest-roster-view-model";
import { QuestRewardIcon } from "./QuestRewardIcon";
import { QuestUnitSlot } from "./QuestUnitSlot";
import type { QuestBattle } from "../hero-quests/quest-battle-data";
import type { HeroQuestJar } from "../hero-quests/hero-quest-view-model";

const cellClass = "border-b border-black/10 px-3 py-2 align-top dark:border-white/15";

// The table-view equivalent of QuestBattleCard - same information (link, roster, reward, jar
// status), just rows instead of stacked cards. Which one actually renders is the caller's call
// (HeroQuestsTab, driven by the app-wide viewMode) - never both at once.
export function QuestBattleTable({ battles, jarByBattleNumber }: { battles: QuestBattle[]; jarByBattleNumber: Map<number, HeroQuestJar> }) {
  return (
    <table className="mt-4 w-full table-auto border-collapse text-left">
      <thead>
        <tr>
          <th className={cellClass}>Reward</th>
          <th className={cellClass}>Battle</th>
          <th className={cellClass}>Roster</th>
          <th className={cellClass}>Jar Status</th>
        </tr>
      </thead>
      <tbody>
        {battles.map((battle) => {
          const jarStatus = formatJarStatus(jarByBattleNumber.get(battle.battleNumber));
          return (
            <tr key={`${battle.battleNumber}-${battle.label}`}>
              <td className={cellClass}>
                <QuestRewardIcon chanceOf={battle.rewardChanceOf} />
              </td>
              <td className={cellClass}>
                {battle.replayUrl ? (
                  <a href={battle.replayUrl} target="_blank" rel="noreferrer" className="underline">
                    {battle.label}
                  </a>
                ) : (
                  battle.label
                )}
              </td>
              <td className={cellClass}>
                <div className="flex flex-wrap gap-2">
                  {battle.roster.map((unit, i) => (
                    <QuestUnitSlot key={`${unit.unitId}-${i}`} unit={toRenderableQuestUnit(unit)} />
                  ))}
                </div>
              </td>
              <td className={cellClass}>{jarStatus}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

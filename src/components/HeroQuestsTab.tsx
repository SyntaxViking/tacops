import { Icon } from "./Icon";
import { QuestBattleCard } from "./QuestBattleCard";
import { QuestBattleTable } from "./QuestBattleTable";
import { activeQuestBattles } from "../hero-quests/quest-battle-data";
import { rarityIconUrl } from "../rarity/rarity-icon";
import type { ViewMode } from "./ViewModeToggle";
import type { HeroQuestJar } from "../hero-quests/hero-quest-view-model";

const cellClass = "border-b border-black/10 px-3 py-2 align-top dark:border-white/15";

export function HeroQuestsTab({ jars, activeQuestIds, viewMode }: { jars: HeroQuestJar[]; activeQuestIds: readonly string[]; viewMode: ViewMode }) {
  if (jars.length === 0) {
    return <p>No Hero Quest data found.</p>;
  }

  // Only when a bundled quest is actually live right now (per the user's own scoping) - the
  // battles are already in descending order (see export_quest_data.py), matching the plain jar
  // table's own Mythic-first ordering. When this is null, the tab falls back to that plain jar
  // table (jars-only, no roster/reward/link - there's nothing else to show it alongside).
  const battles = activeQuestBattles(activeQuestIds);

  if (battles) {
    const jarByBattleNumber = new Map(jars.map((jar) => [jar.battleNumber, jar]));
    // One or the other, never both - the app-wide view toggle (ViewModeToggle) decides, same as
    // every other tab that offers both a card and a table view of the same data.
    return viewMode === "table" ? (
      <QuestBattleTable battles={battles} jarByBattleNumber={jarByBattleNumber} />
    ) : (
      <div className="mt-4 flex w-full flex-col gap-3">
        {battles.map((battle) => (
          <QuestBattleCard key={`${battle.battleNumber}-${battle.label}`} battle={battle} jar={jarByBattleNumber.get(battle.battleNumber)} />
        ))}
      </div>
    );
  }

  return (
    <table className="mt-4 w-full table-auto border-collapse text-left">
      <thead>
        <tr>
          <th className={cellClass}>Rarity</th>
          <th className={cellClass}>Battle</th>
          <th className={cellClass}>Rewards Received</th>
          <th className={cellClass}>Rewards Missed</th>
          <th className={cellClass}>Rewards Remaining</th>
          <th className={cellClass}>Battles Remaining</th>
        </tr>
      </thead>
      <tbody>
        {jars.map((jar) => (
          <tr key={jar.battleNumber}>
            <td className={cellClass}>
              <Icon src={rarityIconUrl(jar.rarity)} />
            </td>
            <td className={cellClass}>{jar.battleNumber}</td>
            <td className={cellClass}>{jar.rewardsReceived}</td>
            <td className={cellClass}>{jar.rewardsMissed}</td>
            <td className={cellClass}>{jar.rewardsRemaining}</td>
            <td className={cellClass}>{jar.battlesRemaining}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

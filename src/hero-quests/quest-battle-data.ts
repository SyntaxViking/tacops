import nubariQuest from "../assets/quests/linear_hero_event_4.json";

// One roster entry as recorded in a replay - raw game numbers (not tacops's own Rank/Rarity/
// RarityStars enums yet, see quest-roster-view-model.ts), null for anything a replay didn't
// record. Generated offline from the raidman-replay-gallery pipeline's own replay parsing (see
// that skill's build_gallery.py) - not derived at runtime from anything tacops itself fetches.
export interface QuestRosterUnit {
  unitId: string;
  rank: number | null;
  starLevel: number | null;
  activeAbilityLevel: number | null;
  passiveAbilityLevel: number | null;
  rarity: number | null;
}

export interface QuestBattle {
  battleNumber: number;
  label: string;
  tierName: string | null;
  // The battle's repeatable drop (GameConfig's loot.chanceOf) - see quest-reward.ts for parsing.
  rewardChanceOf: string | null;
  replayUrl: string | null;
  roster: QuestRosterUnit[];
}

// Keyed by the same id extractActiveQuestIds reads off the live GET_PLAYER response - adding a
// new quest is just one more entry here plus its JSON file, no other code changes.
const QUEST_BATTLES_BY_ID: Record<string, QuestBattle[]> = {
  linear_hero_event_4: nubariQuest as QuestBattle[],
};

// The first bundled quest (in battle-descending order already, see the JSON) among the currently
// live ones - per the user's own scoping, this only ever shows when a quest is BOTH live AND we
// already have its data; null (nothing to show) covers every other case, including a live quest
// we haven't built data for yet.
export function activeQuestBattles(activeQuestIds: readonly string[]): QuestBattle[] | null {
  for (const id of activeQuestIds) {
    const battles = QUEST_BATTLES_BY_ID[id];
    if (battles) return battles;
  }
  return null;
}

import { Rarity } from "../rarity/rarity.enum";

const TOTAL_BATTLES = 17;

// Not present anywhere in the payload - confirmed directly by the user, same "game knowledge, not
// datamined" convention as some of the resource-regen.ts constants.
const BATTLE_RARITY: Record<number, Rarity> = {
  1: Rarity.Common,
  2: Rarity.Common,
  3: Rarity.Common,
  4: Rarity.Uncommon,
  5: Rarity.Uncommon,
  6: Rarity.Uncommon,
  7: Rarity.Rare,
  8: Rarity.Rare,
  9: Rarity.Rare,
  10: Rarity.Rare,
  11: Rarity.Rare,
  12: Rarity.Epic,
  13: Rarity.Epic,
  14: Rarity.Epic,
  15: Rarity.Legendary,
  16: Rarity.Legendary,
  17: Rarity.Mythic,
};

const MYTHIC_TOTAL_REWARDS = 1;
const MYTHIC_TOTAL_BATTLES = 6;
const DEFAULT_TOTAL_REWARDS = 3;
const DEFAULT_TOTAL_BATTLES = 4;

export interface HeroQuestJar {
  battleNumber: number;
  rarity: Rarity;
  rewardsReceived: number;
  rewardsMissed: number;
  rewardsRemaining: number;
  battlesRemaining: number;
}

interface UrnOfBallsEntry {
  savedRolls?: { won?: number; lost?: number };
}

// Battle numbers run 1 (Common) -> 17 (Mythic), strictly increasing in rarity, so sorting
// descending by battle number alone already yields the desired "Mythic first, then descending
// battle number within each tier" display order - no compound sort needed.
export function computeHeroQuestJars(urnOfBalls: Record<string, UrnOfBallsEntry> | undefined): HeroQuestJar[] {
  const jars: HeroQuestJar[] = [];
  for (let battleNumber = TOTAL_BATTLES; battleNumber >= 1; battleNumber--) {
    const rarity = BATTLE_RARITY[battleNumber];
    const savedRolls = urnOfBalls?.[`LHE${battleNumber}`]?.savedRolls;
    const won = savedRolls?.won ?? 0;
    const lost = savedRolls?.lost ?? 0;
    const isMythic = rarity === Rarity.Mythic;
    const totalRewards = isMythic ? MYTHIC_TOTAL_REWARDS : DEFAULT_TOTAL_REWARDS;
    const totalBattles = isMythic ? MYTHIC_TOTAL_BATTLES : DEFAULT_TOTAL_BATTLES;
    jars.push({
      battleNumber,
      rarity,
      rewardsReceived: won,
      rewardsMissed: lost,
      rewardsRemaining: totalRewards - won,
      battlesRemaining: totalBattles - (won + lost),
    });
  }
  return jars;
}

// "X received from Y attempts (Z attempts remaining)" for a single battle's card in the quest
// tab - Y is every attempt made so far (received + missed), Z is battlesRemaining (how many more
// tries are left in this reward cycle). null when there's no jar for this battle number at all
// (shouldn't happen for a real quest battle, but a bundled quest's battle numbers are offline
// data, not guaranteed to line up).
export function formatJarStatus(jar: HeroQuestJar | undefined): string | null {
  if (!jar) return null;
  const attempts = jar.rewardsReceived + jar.rewardsMissed;
  return `${jar.rewardsReceived} received from ${attempts} attempts (${jar.battlesRemaining} attempts remaining)`;
}

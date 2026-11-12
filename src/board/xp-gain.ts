import { Rarity } from "../rarity/rarity.enum";
import { RarityMapper } from "../rarity/rarity.mapper";

// A character's XP from one operation grows with their power and with the operation's rarity:
//   xp ~ g[operation rarity] * power^XP_POWER_EXPONENT
// Fitted to in-game results from a Mythic, Legendary, Epic, Rare and Uncommon operation (accurate
// to roughly +/-10%). Common had no sample, so its factor is extrapolated from the others - replace
// it once a real number is known.
const XP_RARITY_FACTOR: Record<Rarity, number> = {
  [Rarity.Mythic]: 11.4,
  [Rarity.Legendary]: 10.8,
  [Rarity.Epic]: 7.08,
  [Rarity.Rare]: 5.64,
  [Rarity.Uncommon]: 5.45,
  [Rarity.Common]: 5,
};
const XP_POWER_EXPONENT = 0.37;

export function isXpCapped(rarity: Rarity, xpLevel: number): boolean {
  return xpLevel >= RarityMapper.xpLevelCap[rarity];
}

// Estimated XP a character earns from running one operation of the given rarity. XP-capped
// characters earn nothing; so does a character whose power is unknown, since there's nothing to
// estimate from. Only ever used to compare assignments, so the absolute scale doesn't matter -
// but it is intentionally NOT rounded: the XP pass is the last one and is never locked in.
export function estimateXpGain(operationRarity: Rarity, unitRarity: Rarity, xpLevel: number, power: number | null): number {
  if (isXpCapped(unitRarity, xpLevel)) return 0;
  if (power === null || power <= 0) return 0;
  return XP_RARITY_FACTOR[operationRarity] * power ** XP_POWER_EXPONENT;
}

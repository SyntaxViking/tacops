export type OnslaughtMetal = "stone" | "iron" | "bronze" | "silver" | "gold" | "diamond" | "mythic";
export type OnslaughtFrameRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

const METALS: OnslaughtMetal[] = ["stone", "iron", "bronze", "silver", "gold", "diamond", "mythic"];

// tier matches the Rank enum directly (1-21, see onslaught-extraction.ts) - each metal spans 3
// consecutive tiers (1-3 stone, 4-6 iron, ... 19-21 the top rank). The game's own GameConfig names
// that top rank group "mythic" in its tiers[].visualId (not "adamantine", despite rank.enum.ts
// calling it Adamantine) - confirmed against the onslaught-icons asset filenames too, which only
// go up to "mythic".
export function metalForTier(tier: number): OnslaughtMetal {
  return METALS[Math.floor((tier - 1) / 3)];
}

// This tier's position (1, 2, or 3) within its own metal's 3-tier group - independent of whether
// it's currently displayed as a collapsed "challenge" (see onslaughtRankIconUrl).
export function positionInMetal(tier: number): 1 | 2 | 3 {
  return (((tier - 1) % 3) + 1) as 1 | 2 | 3;
}

// Confirmed with the user: Stone and Iron share the "common" frame color - not a clean 1:1
// metal->rarity mapping like the other 5.
const FRAME_RARITY_BY_METAL: Record<OnslaughtMetal, OnslaughtFrameRarity> = {
  stone: "common",
  iron: "common",
  bronze: "uncommon",
  silver: "rare",
  gold: "epic",
  diamond: "legendary",
  mythic: "mythic",
};

export function frameRarityForMetal(metal: OnslaughtMetal): OnslaughtFrameRarity {
  return FRAME_RARITY_BY_METAL[metal];
}

export function onslaughtFrameUrl(rarity: OnslaughtFrameRarity): string {
  return new URL(`../assets/onslaught-icons/ui_onslaught_button_frame_${rarity}.png`, import.meta.url).href;
}

// Overlaid on top of the normal rarity frame (not instead of it) whenever a tier is a collapsed
// challenge - confirmed with the user: "there's an additional part of the frame, the challenge
// bit", layered alongside the regular colored frame rather than replacing it.
export const ONSLAUGHT_CHALLENGE_FRAME_URL = new URL(
  "../assets/onslaught-icons/ui_onslaught_button_frame_challenge.png",
  import.meta.url,
).href;

// isChallenge comes from extractOnslaughtBoards: true once a rank's "1"/"2" sub-tiers have
// collapsed away and only the repeatable "3" challenge battle remains - the "4" icon variant
// (a skull, vs. a plain numeral for 1/2/3) represents that collapsed state, not the literal tier
// number. positions 1/2 never have a "challenge" variant.
export function onslaughtRankIconUrl(tier: number, isChallenge: boolean): string {
  const metal = metalForTier(tier);
  const position = isChallenge ? 4 : positionInMetal(tier);
  return new URL(`../assets/onslaught-icons/ui_onslaught_button_rank_${metal}_${position}.png`, import.meta.url).href;
}

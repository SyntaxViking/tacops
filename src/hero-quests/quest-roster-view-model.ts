import { characterPortraitUrl } from "../characters/character-portraits";
import { rankIconUrl } from "../rank/rank-icon";
import { intToRank } from "../rank/rank.mapper";
import { rarityHaloFilter } from "../rarity/rarity-halo";
import { starIconUrls } from "../rarity/rarity-stars-icon";
import type { Rarity } from "../rarity/rarity.enum";
import type { RarityStars } from "../rarity/rarity-stars.enum";
import type { QuestRosterUnit } from "./quest-battle-data";

export interface RenderableQuestUnit {
  unitId: string;
  // null when the unit id isn't one tacops has a portrait mapped for (characterPortraitUrl throws
  // in that case) - shouldn't happen for a quest's own roster, but a missing one is more useful as
  // a blank slot than a crashed tab.
  portraitUrl: string | null;
  haloFilter: string | null;
  rankIconUrl: string | null;
  starIconUrls: string[];
  activeAbilityLevel: number | null;
  passiveAbilityLevel: number | null;
}

// The replay's raw numbers (rank, starLevel, rarity) use the exact same 0-based scales tacops's
// own Rank/RarityStars/Rarity enums already assume elsewhere (rank.mapper.ts's intToRank; Rarity
// and RarityStars are plain 0-based enums matching the game's own Rarity/StarLevel fields
// directly) - confirmed against a real extracted roster (e.g. starLevel 14 -> RarityStars.
// MythicWings, rarity 5 -> Rarity.Mythic, rank 20 -> Rank.Adamantine3 via intToRank), so no
// separate conversion table is needed here.
export function toRenderableQuestUnit(unit: QuestRosterUnit): RenderableQuestUnit {
  let portraitUrl: string | null;
  try {
    portraitUrl = characterPortraitUrl(unit.unitId);
  } catch {
    portraitUrl = null;
  }
  return {
    unitId: unit.unitId,
    portraitUrl,
    haloFilter: unit.rarity !== null ? rarityHaloFilter(unit.rarity as Rarity) : null,
    rankIconUrl: unit.rank !== null ? rankIconUrl(intToRank(unit.rank)) : null,
    starIconUrls: unit.starLevel !== null ? starIconUrls(unit.starLevel as RarityStars) : [],
    activeAbilityLevel: unit.activeAbilityLevel,
    passiveAbilityLevel: unit.passiveAbilityLevel,
  };
}

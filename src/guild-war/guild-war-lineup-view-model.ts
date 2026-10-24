import { getCharacterRow, type CharacterRow } from "../characters/character-view-model";
import { getMowRow, type MowRow } from "../mow/mow-view-model";
import { rarityIconUrl } from "../rarity/rarity-icon";
import { Rarity } from "../rarity/rarity.enum";
import type { GuildWarCharacterSlot, GuildWarMachineOfWar, RawUnit } from "../api/types";

// rarityCaps' values are the game's own rarity names ("Epic", "Rare", ...), which match the
// Rarity enum's member names exactly - this is just that string->enum reverse lookup.
export function rarityIconUrlForCap(cap: string): string | null {
  const rarity = Rarity[cap as keyof typeof Rarity];
  return rarity === undefined ? null : rarityIconUrl(rarity);
}

// Adapts a guild war character slot into the same CharacterRow shape the Characters tab uses, so
// the portrait/rank/rarity/stars/damage-profile icons are pixel-identical everywhere in the app.
// Returns null (rather than throwing) for a unit id the bundled character data doesn't know about
// - e.g. a character added to the game since this build's data was last extracted - so one
// unrecognized unit can't take down the whole detail view.
export function getGuildWarCharacterRow(slot: GuildWarCharacterSlot): CharacterRow | null {
  try {
    const rawUnit: RawUnit = {
      id: slot.unitId,
      rank: slot.rank,
      progressionIndex: slot.progressionIndex,
      extraDamageProfiles: slot.extraDamageProfiles,
    };
    return getCharacterRow(rawUnit);
  } catch (error) {
    console.error(`[guild-war] getCharacterRow failed for ${slot.unitId}`, error);
    return null;
  }
}

// Same idea as getGuildWarCharacterRow, but for the lineup's machine of war - getMowRow reads its
// ability levels from `active`/`passive` (the field names the regular units.units snapshot uses),
// unlike the guild war snapshot's own activeAbilityLevel/passiveAbilityLevel, hence the rename.
export function getGuildWarMowRow(mow: GuildWarMachineOfWar): MowRow | null {
  try {
    const rawUnit: RawUnit = {
      id: mow.unitId,
      progressionIndex: mow.progressionIndex,
      active: mow.activeAbilityLevel,
      passive: mow.passiveAbilityLevel,
    };
    return getMowRow(rawUnit);
  } catch (error) {
    console.error(`[guild-war] getMowRow failed for ${mow.unitId}`, error);
    return null;
  }
}

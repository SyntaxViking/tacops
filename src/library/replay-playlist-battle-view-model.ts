// Pure view-model for the standalone "replay playlist" reference pages (see library/ at the repo
// root) - turns a plain data description of a battle's required 5-character lineup into the icon
// URLs the page renders, reusing the exact same rank/rarity/star/portrait lookups the main app's
// Characters tab uses (character-view-model.ts), so a lineup drawn here matches what the same
// rank/rarity/stars look like everywhere else in TacOps.
import { rankIconUrl } from "../rank/rank-icon";
import type { Rank } from "../rank/rank.enum";
import { rarityIconUrl } from "../rarity/rarity-icon";
import type { Rarity } from "../rarity/rarity.enum";
import { starIconUrls } from "../rarity/rarity-stars-icon";
import type { RarityStars } from "../rarity/rarity-stars.enum";
import { characterPortraitUrl } from "../characters/character-portraits";
import { getCharacterProfile } from "../characters/character-profile";

// One character slot in a battle's recommended/required lineup, as typed in by hand from a
// screenshot or in-game reference - everything here is a fact about that one character at that
// one battle, not derived from any live account data.
export interface ReplayPlaylistCharacterSlot {
  characterId: string;
  rank: Rank;
  rarity: Rarity;
  stars: RarityStars;
  // The two ability levels shown under the portrait (e.g. "65/65") - active/passive, in whichever
  // order the source lists them.
  abilityLevel1: number;
  abilityLevel2: number;
}

export interface ReplayPlaylistBattle {
  // The playlist's own battle number (not necessarily sequential/contiguous - a playlist can skip
  // numbers for difficulties this page doesn't cover), shown as the row's label.
  battleNumber: number;
  characters: ReplayPlaylistCharacterSlot[];
  // The raidman.com replay link for this specific battle - the whole row links out to it.
  replayUrl: string;
}

export interface ReplayPlaylistCharacterSlotRow {
  characterId: string;
  name: string;
  portraitUrl: string;
  rankIconUrl: string;
  rarityIconUrl: string;
  starIconUrls: string[];
  abilityLevel1: number;
  abilityLevel2: number;
}

export function getReplayPlaylistCharacterSlotRow(slot: ReplayPlaylistCharacterSlot): ReplayPlaylistCharacterSlotRow {
  return {
    characterId: slot.characterId,
    name: getCharacterProfile(slot.characterId).name,
    portraitUrl: characterPortraitUrl(slot.characterId),
    rankIconUrl: rankIconUrl(slot.rank),
    rarityIconUrl: rarityIconUrl(slot.rarity),
    starIconUrls: starIconUrls(slot.stars),
    abilityLevel1: slot.abilityLevel1,
    abilityLevel2: slot.abilityLevel2,
  };
}

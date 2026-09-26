import { intToRank } from "../rank/rank.mapper";
import { rankIconUrl } from "../rank/rank-icon";
import { rarityIconUrl } from "../rarity/rarity-icon";
import { starIconUrls } from "../rarity/rarity-stars-icon";
import { ProgressionIndexMapper } from "../progression/progression-index";
import { characterPortraitUrl } from "./character-portraits";
import { getCharacterProfile } from "./character-profile";
import { damageProfileIconUrl } from "./damage-profile-icon";
import { traitIconUrl } from "./trait-icon";
import { factionIconUrl } from "../factions/faction-icon";
import type { RawUnit } from "../api/types";

export interface CharacterRow {
  id: string;
  name: string;
  power?: number;
  portraitUrl: string;
  faction: string;
  factionIconUrl?: string;
  rarityIconUrl: string;
  starIconUrls: string[];
  rankIconUrl: string;
  damageProfileIconUrls: string[];
  traitIconUrls: string[];
}

export type CharacterSortMode = "powerDesc" | "nameAsc" | "factionThenName";

// factionThenName sorts by the raw faction id (character-profile.ts's "faction" field) - the same
// value the table falls back to displaying as text when a faction has no icon, so it's the
// closest thing to a "faction name" the app already surfaces.
export function sortCharacterRows(rows: CharacterRow[], mode: CharacterSortMode): CharacterRow[] {
  const sorted = [...rows];
  switch (mode) {
    case "powerDesc":
      sorted.sort((a, b) => (b.power ?? -Infinity) - (a.power ?? -Infinity));
      break;
    case "nameAsc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "factionThenName":
      sorted.sort((a, b) => a.faction.localeCompare(b.faction) || a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

export function getCharacterRow(hero: RawUnit): CharacterRow {
  const rank = intToRank(hero.rank);
  const rarity = ProgressionIndexMapper.toRarity(hero.progressionIndex);
  const stars = ProgressionIndexMapper.toStars(hero.progressionIndex);
  const profile = getCharacterProfile(hero.id, hero.extraDamageProfiles);

  return {
    id: hero.id,
    name: profile.name,
    power: hero.power,
    portraitUrl: characterPortraitUrl(hero.id),
    faction: profile.faction,
    factionIconUrl: factionIconUrl(profile.faction),
    rarityIconUrl: rarityIconUrl(rarity),
    starIconUrls: starIconUrls(stars),
    rankIconUrl: rankIconUrl(rank),
    damageProfileIconUrls: profile.damageProfiles.map((profileId) => damageProfileIconUrl(profileId)),
    traitIconUrls: profile.traits
      .filter((trait) => trait !== "Hero")
      .map((trait) => traitIconUrl(trait))
      .filter((url): url is string => url !== undefined),
  };
}

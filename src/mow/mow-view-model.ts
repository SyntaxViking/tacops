import { rarityIconUrl } from "../rarity/rarity-icon";
import { starIconUrls } from "../rarity/rarity-stars-icon";
import { ProgressionIndexMapper } from "../progression/progression-index";
import { factionIconUrl } from "../factions/faction-icon";
import { getMowProfile, mowPortraitUrl } from "./mow-profile";
import type { RawUnit } from "../api/types";

export interface MowRow {
  id: string;
  name: string;
  portraitUrl: string;
  faction: string;
  factionIconUrl?: string;
  rarityIconUrl: string;
  starIconUrls: string[];
  activeLevel?: number;
  passiveLevel?: number;
  power?: number;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

// Throws for an unrecognized machine of war id. For live/untrusted data, use getSafeMowRow
// instead - see character-view-model.ts's getCharacterRow/getSafeCharacterRow for the same split.
export function getMowRow(mow: RawUnit): MowRow {
  // Machines of war carry both `progressionIndex` and an identical `starLevel`;
  // either one maps to rarity and stars exactly like a character's does.
  const progressionIndex = mow.progressionIndex ?? asNumber(mow.starLevel);
  const profile = getMowProfile(mow.id);

  return {
    id: mow.id,
    name: profile.name,
    portraitUrl: mowPortraitUrl(profile.portraitFile),
    faction: profile.faction,
    factionIconUrl: factionIconUrl(profile.faction),
    rarityIconUrl: rarityIconUrl(ProgressionIndexMapper.toRarity(progressionIndex)),
    starIconUrls: starIconUrls(ProgressionIndexMapper.toStars(progressionIndex)),
    activeLevel: asNumber(mow.active),
    passiveLevel: asNumber(mow.passive),
    power: mow.power,
  };
}

// Returns null (rather than throwing) for a MoW id the bundled data doesn't know about - see
// getSafeCharacterRow's comment for the full reasoning.
export function getSafeMowRow(mow: RawUnit, logTag: string): MowRow | null {
  try {
    return getMowRow(mow);
  } catch (error) {
    console.error(`[${logTag}] getMowRow failed for ${mow.id}`, error);
    return null;
  }
}

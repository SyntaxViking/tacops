import { ProgressionIndexMapper } from "../progression/progression-index";
import { intToRank } from "../rank/rank.mapper";
import { rankIconUrl } from "../rank/rank-icon";
import type { Rarity } from "../rarity/rarity.enum";
import { rarityIconUrl } from "../rarity/rarity-icon";
import { starIconUrls } from "../rarity/rarity-stars-icon";
import { characterPortraitUrl } from "../characters/character-portraits";
import { getCharacterProfile } from "../characters/character-profile";
import { getMowProfile, mowPortraitUrl } from "../mow/mow-profile";
import { getPowerItemInfo, itemFrameTiers } from "./pvp-equipment";
import { itemIconUrl, itemFrameUrl } from "./item-icon";
import { avatarUrl, avatarFrameUrl } from "./avatar";
import type { RawPvpEncounter, RawPvpItemInstance, RawPvpUnit } from "../api/types";

export interface PvpEquipmentSlot {
  itemId: string;
  level: number;
  name: string;
  iconUrl: string | null;
  frameUrls: string[];
}

interface PvpSlotCommon {
  name: string;
  portraitUrl: string;
  rarity: Rarity;
  rarityIconUrl: string;
  starIconUrls: string[];
  activeLevel: number | null;
  passiveLevel: number | null;
}

export interface PvpCharacterSlot extends PvpSlotCommon {
  kind: "character";
  characterId: string;
  rankIconUrl: string;
  // Fixed 3 slots (every character's itemSlots has exactly 3 entries - see character-data.json),
  // null for an unfilled slot.
  equipment: (PvpEquipmentSlot | null)[];
}

// No equipment field at all (not just empty) - Machine of War units have no items in the raw
// data, unlike characters whose `items` is merely absent-or-empty for an unfilled slot.
export interface PvpMowSlot extends PvpSlotCommon {
  kind: "mow";
  mowId: string;
}

export type PvpUnitSlot = PvpCharacterSlot | PvpMowSlot;

export interface PvpOpponentCard {
  userId: string;
  displayName: string;
  rating: number;
  level: number;
  ratingGain: number;
  ratingLoss: number;
  avatarUrl: string | null;
  avatarFrameUrl: string | null;
  boardId: string;
  spawnPointsSet: number;
  // The fielded character ids in lineup order, separately from `units` (which also carries the
  // resolved MoW slot appended at the end) - board-layout.ts's resolveCharacterSpawnPositions
  // needs exactly this order to pair against the board's own spawn point order.
  lineup: string[];
  units: PvpUnitSlot[];
}

const EQUIPMENT_SLOT_KEYS = ["Slot1", "Slot2", "Slot3"];

export function getPvpEquipmentSlot(
  instanceId: string | undefined,
  itemsById: Record<string, RawPvpItemInstance>,
): PvpEquipmentSlot | null {
  if (!instanceId) return null;
  const instance = itemsById[instanceId];
  if (!instance) return null;
  const info = getPowerItemInfo(instance.itemId);
  return {
    itemId: instance.itemId,
    level: instance.level,
    name: info.name,
    iconUrl: itemIconUrl(instance.itemId),
    frameUrls: itemFrameTiers(info.rarity, info.isRelic).map(itemFrameUrl),
  };
}

// Returns null (rather than throwing) for a character id the bundled data doesn't know about -
// e.g. a character added to the game since this build's data was last extracted - so one
// opponent fielding an unrecognized unit can't take down the whole Arena tab. Wraps the whole
// body, not just getCharacterProfile: characterPortraitUrl below is an independent throwing
// lookup (its own hand-maintained table, not character-data.json) that can fail on its own.
export function getPvpCharacterSlot(
  characterId: string,
  unit: RawPvpUnit,
  itemsById: Record<string, RawPvpItemInstance>,
): PvpCharacterSlot | null {
  try {
    const stars = ProgressionIndexMapper.toStars(unit.progressionIndex);
    const rarity = ProgressionIndexMapper.toRarity(unit.progressionIndex);
    return {
      kind: "character",
      characterId,
      name: getCharacterProfile(characterId).name,
      portraitUrl: characterPortraitUrl(characterId),
      rankIconUrl: rankIconUrl(intToRank(unit.rank)),
      rarity,
      rarityIconUrl: rarityIconUrl(rarity),
      starIconUrls: starIconUrls(stars),
      activeLevel: unit.active ?? null,
      passiveLevel: unit.passive ?? null,
      equipment: EQUIPMENT_SLOT_KEYS.map((slotKey) => getPvpEquipmentSlot(unit.items?.[slotKey], itemsById)),
    };
  } catch (error) {
    console.error(`[pvp] getPvpCharacterSlot failed for ${characterId}`, error);
    return null;
  }
}

// Same reasoning as getPvpCharacterSlot above.
export function getPvpMowSlot(mowId: string, unit: RawPvpUnit): PvpMowSlot | null {
  try {
    const profile = getMowProfile(mowId);
    const stars = ProgressionIndexMapper.toStars(unit.progressionIndex);
    const rarity = ProgressionIndexMapper.toRarity(unit.progressionIndex);
    return {
      kind: "mow",
      mowId,
      name: profile.name,
      portraitUrl: mowPortraitUrl(profile.portraitFile),
      rarity,
      rarityIconUrl: rarityIconUrl(rarity),
      starIconUrls: starIconUrls(stars),
      activeLevel: unit.active ?? null,
      passiveLevel: unit.passive ?? null,
    };
  } catch (error) {
    console.error(`[pvp] getPvpMowSlot failed for ${mowId}`, error);
    return null;
  }
}

export function getPvpOpponentCard(encounter: RawPvpEncounter): PvpOpponentCard {
  const { opponent } = encounter;
  const itemsById = opponent.items.items;
  const unitsById = opponent.units.units;

  const characterSlots = opponent.units.lineup.pvp
    .filter((characterId) => unitsById[characterId])
    .map((characterId) => getPvpCharacterSlot(characterId, unitsById[characterId], itemsById))
    .filter((slot): slot is PvpCharacterSlot => slot !== null);

  const mowId = opponent.units.mowLineup.pvp;
  const resolvedMowSlot = mowId && unitsById[mowId] ? getPvpMowSlot(mowId, unitsById[mowId]) : null;
  const mowSlot = resolvedMowSlot ? [resolvedMowSlot] : [];

  return {
    userId: opponent.userId,
    displayName: opponent.displayName,
    rating: opponent.rating,
    level: opponent.level,
    ratingGain: encounter.ratingGain,
    ratingLoss: encounter.ratingLoss,
    avatarUrl: avatarUrl(opponent.avatar),
    avatarFrameUrl: avatarFrameUrl(opponent.avatarFrameId),
    boardId: encounter.boardId,
    // Confirmed via a real capture: absent means 0, not "unknown" - see RawPvpEncounter.
    spawnPointsSet: encounter.spawnPointsSet ?? 0,
    lineup: opponent.units.lineup.pvp,
    units: [...characterSlots, ...mowSlot],
  };
}

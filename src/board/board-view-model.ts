import { Rarity } from "../rarity/rarity.enum";
import { RarityMapper } from "../rarity/rarity.mapper";
import { rarityIconUrl } from "../rarity/rarity-icon";
import { traitIconUrl } from "../characters/trait-icon";
import { damageProfileIconUrl } from "../characters/damage-profile-icon";
import { characterPortraitUrl, hasCharacterPortrait } from "../characters/character-portraits";
import { factionIconUrl } from "../factions/faction-icon";
import { rangedAttackIconUrl } from "./ranged-attack-icon";
import { rewardIconUrl } from "./reward-icon";
import { operationTypeIconUrl } from "./operation-type-icon";
import { isCharacterId } from "../api/fetch-player-data";
import type { BonusObjective, ExpeditionBoardEntry } from "../api/types";

// "Dispatched" is mid-run; "Completed" means the op finished but its reward hasn't been claimed
// yet - the squad hasn't returned in either case, so both are untouchable/undeployable.
// Matched case-insensitively - an exact-case mismatch here would silently leave dispatched
// entries looking "available", both breaking the solver stuck-on-"Solving" fast path below and
// mislabeling the entry as Ready in the UI.
const UNAVAILABLE_STATUSES = new Set(["dispatched", "completed"]);

function normalizedStatus(entry: ExpeditionBoardEntry): string {
  return entry.status.toLowerCase();
}

export function entryIsUnavailable(entry: ExpeditionBoardEntry): boolean {
  return UNAVAILABLE_STATUSES.has(normalizedStatus(entry));
}

export function entryStatusLabel(entry: ExpeditionBoardEntry): "Ready" | "Dispatched" | "Complete" {
  const status = normalizedStatus(entry);
  if (status === "dispatched") return "Dispatched";
  if (status === "completed") return "Complete";
  return "Ready";
}

export function entryFinishAt(entry: ExpeditionBoardEntry): number | null {
  if (normalizedStatus(entry) !== "dispatched" || entry.startedOn === undefined) {
    return null;
  }
  return entry.startedOn + entry.duration * 1000;
}

export function entryRarity(entry: ExpeditionBoardEntry): Rarity {
  const rarity = RarityMapper.stringToRarity(entry.rarity);
  if (rarity === undefined) {
    throw new Error(`Unknown board rarity: ${entry.rarity}`);
  }
  return rarity;
}

export function sortByRarityDescending(board: ExpeditionBoardEntry[]): ExpeditionBoardEntry[] {
  return [...board].sort((a, b) => entryRarity(b) - entryRarity(a));
}

export function categoryIconUrl(entry: ExpeditionBoardEntry): string {
  return operationTypeIconUrl(entry.category);
}

export function entryRarityIconUrl(entry: ExpeditionBoardEntry): string {
  return rarityIconUrl(entryRarity(entry));
}

export interface ObjectiveDisplay {
  label: string;
  iconUrl?: string;
  badge?: "no-ranged-attack";
}

export function getObjectiveDisplay(objective: BonusObjective): ObjectiveDisplay {
  const label = objective.objectiveTarget
    ? `${objective.objectiveType}: ${objective.objectiveTarget}`
    : objective.objectiveType;

  if (objective.objectiveType === "HasNoRangedAttack") {
    return { label, iconUrl: rangedAttackIconUrl(), badge: "no-ranged-attack" };
  }
  if (objective.objectiveType === "HasRangedAttack") {
    return { label, iconUrl: rangedAttackIconUrl() };
  }
  if (!objective.objectiveTarget) {
    return { label };
  }
  switch (objective.objectiveType) {
    case "Trait":
      return { label, iconUrl: traitIconUrl(objective.objectiveTarget) };
    case "DamageType":
      return { label, iconUrl: damageProfileIconUrl(objective.objectiveTarget) };
    case "Faction":
      return { label, iconUrl: factionIconUrl(objective.objectiveTarget) };
    default:
      return { label };
  }
}

export interface RewardChip {
  label: string;
  iconUrl?: string;
  amount?: string;
}

export function getRewardChips(rewards: string[]): RewardChip[] {
  return rewards.map((reward) => {
    const [key, amount] = reward.split(":");
    const iconUrl = rewardIconUrl(key);
    return iconUrl ? { label: reward, iconUrl, amount } : { label: reward };
  });
}

export interface DispatchedUnit {
  unitId: string;
  portraitUrl?: string;
}

export function getDispatchedUnits(entry: ExpeditionBoardEntry): DispatchedUnit[] | undefined {
  if (!entryIsUnavailable(entry) || !entry.units || entry.units.length === 0) {
    return undefined;
  }
  return entry.units.map((unitId) => ({
    unitId,
    // A unit can be a recognized character id without a mapped portrait (e.g. one added to
    // character-data.json before its portrait asset lands) - same guard as the board-overlay
    // callers in character-portraits.ts's own hasCharacterPortrait comment.
    portraitUrl: isCharacterId(unitId) && hasCharacterPortrait(unitId) ? characterPortraitUrl(unitId) : undefined,
  }));
}

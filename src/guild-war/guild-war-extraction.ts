import { relicAbilityDamageProfiles } from "../characters/character-profile";
import type { GuildWarBattlefield, GuildWarCharacterSlot, GuildWarData, GuildWarLineup, GuildWarMachineOfWar } from "../api/types";

// hero is GET_PLAYER's player.hero. Matched by the module's own moduleType ("guildWarEvent"),
// not by the live event's own id/name - same convention as fetch-player-data.ts's other
// recurring-module lookups (LHE, seasonal event, Legendary Event), since those can vary across
// runs while the module type stays fixed. Confirmed against a real capture where the live
// event's own `name` was "guildWar".
function findGuildWarModule(hero: any): any {
  return hero?.liveEvents?.liveEvents
    ?.find((event: any) => event?.modules?.some((m: any) => m.type === "guildWarEvent"))
    ?.modules?.find((m: any) => m.type === "guildWarEvent")?.module;
}

// Rarity caps are keyed by zone *tier* ("Hero"/"Elite"/"Veteran"/"Trooper"), not by zone type
// directly - which tier a given warZoneType maps to depends on the current battlefieldLevel
// (config.battlefieldConfig.battleFieldLevels[*].zoneTiers), and each tier's rarityCaps (5
// entries, one per lineup slot) lives in the sibling top-level config.battlefieldConfig.zoneTiers
// list. Both confirmed against a real capture (battlefieldLevel 5: "Trenches1" -> "Veteran" ->
// ["Epic","Epic","Rare","Rare","Rare"]). boardId/spawnPointsSet come from a separate, simpler
// config (config.zoneTypeConfigs[warZoneType]) that isn't battlefieldLevel-dependent.
interface ZoneTypeConfig {
  boardId: string;
  spawnPointsSet?: number;
}

interface SiteConfigLookup {
  zoneTierIdByWarZoneType: Map<string, string>;
  rarityCapsByZoneTierId: Map<string, string[]>;
  zoneTypeConfigByWarZoneType: Map<string, ZoneTypeConfig>;
}

function buildSiteConfigLookup(module: any): SiteConfigLookup {
  const levelConfig = module?.config?.battlefieldConfig?.battleFieldLevels?.find(
    (level: any) => level?.battlefieldLevel === module?.battlefieldLevel,
  );
  const zoneTierIdByWarZoneType = new Map<string, string>(
    (levelConfig?.zoneTiers ?? [])
      .filter((entry: any) => typeof entry?.warZoneType === "string" && typeof entry?.zoneTierId === "string")
      .map((entry: any) => [entry.warZoneType, entry.zoneTierId]),
  );
  const rarityCapsByZoneTierId = new Map<string, string[]>(
    (module?.config?.battlefieldConfig?.zoneTiers ?? [])
      .filter((entry: any) => typeof entry?.zoneTierId === "string" && Array.isArray(entry?.rarityCaps))
      .map((entry: any) => [entry.zoneTierId, entry.rarityCaps]),
  );
  const zoneTypeConfigByWarZoneType = new Map<string, ZoneTypeConfig>(
    Object.entries(module?.config?.zoneTypeConfigs ?? {})
      .filter((entry): entry is [string, { boardId: string; spawnPointsSet?: number }] => typeof (entry[1] as any)?.boardId === "string")
      .map(([warZoneType, config]) => [
        warZoneType,
        { boardId: config.boardId, spawnPointsSet: numberOrUndefined(config.spawnPointsSet) },
      ]),
  );
  return { zoneTierIdByWarZoneType, rarityCapsByZoneTierId, zoneTypeConfigByWarZoneType };
}

function rarityCapsForZoneType(zoneType: string | null, lookup: SiteConfigLookup): string[] | null {
  if (zoneType === null) return null;
  const zoneTierId = lookup.zoneTierIdByWarZoneType.get(zoneType);
  if (zoneTierId === undefined) return null;
  return lookup.rarityCapsByZoneTierId.get(zoneTierId) ?? null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

// A lineup (zonePart*.warZoneSlots[i]) carries a `defeatedByUserId` once it's been fully cleared
// - at that point its individual units no longer carry their own `remainingHp` (confirmed against
// a real capture), so the whole-lineup flag is the only signal left and applies to every
// character (and the machine of war, which never has its own remainingHp at all) in it. Short of
// that, an individual character reads as defeated once its own `remainingHp` (persisted chip
// damage carried across attempts) hits 0, even while its lineup-mates are still standing.
function toCharacterSlot(unit: any, lineupDefeated: boolean): GuildWarCharacterSlot {
  const info = unit?.unitInfo ?? {};
  return {
    unitId: info.id ?? "",
    rank: numberOrUndefined(info.rank),
    progressionIndex: numberOrUndefined(info.progressionIndex),
    xpLevel: numberOrUndefined(info.xpLevel),
    activeAbilityLevel: numberOrUndefined(info.activeAbilityLevel),
    passiveAbilityLevel: numberOrUndefined(info.passiveAbilityLevel),
    extraDamageProfiles: relicAbilityDamageProfiles(info.relicAbilities),
    defeated: lineupDefeated || (typeof unit?.remainingHp === "number" && unit.remainingHp <= 0),
  };
}

function toMachineOfWarSlot(mow: any, lineupDefeated: boolean): GuildWarMachineOfWar | null {
  const info = mow?.unitInfo;
  if (!info) return null;
  return {
    unitId: info.id ?? "",
    progressionIndex: numberOrUndefined(info.progressionIndex),
    xpLevel: numberOrUndefined(info.xpLevel),
    activeAbilityLevel: numberOrUndefined(info.activeAbilityLevel),
    passiveAbilityLevel: numberOrUndefined(info.passiveAbilityLevel),
    defeated: lineupDefeated,
  };
}

function toLineups(part: any): GuildWarLineup[] | null {
  const slots = part?.warZoneSlots;
  if (!Array.isArray(slots)) return null;
  return slots.map((slot: any) => {
    const defeated = typeof slot?.defeatedByUserId === "string";
    const units = Array.isArray(slot?.defendingUnits) ? slot.defendingUnits : [];
    return {
      characters: units.map((unit: any) => toCharacterSlot(unit, defeated)),
      machineOfWar: toMachineOfWarSlot(slot?.defendingMachineOfWar, defeated),
      defeated,
    };
  });
}

function toBattlefield(warZones: unknown, lookup: SiteConfigLookup): GuildWarBattlefield | null {
  if (!Array.isArray(warZones)) return null;
  return warZones.map((row) =>
    (Array.isArray(row) ? row : []).map((zone: any) => {
      const zoneType = zone?.warZoneType ?? null;
      const lineups1 = toLineups(zone?.zonePart1);
      const lineups2 = toLineups(zone?.zonePart2);
      const zoneTypeConfig = zoneType !== null ? lookup.zoneTypeConfigByWarZoneType.get(zoneType) : undefined;
      return {
        zoneId: zone?.zoneId ?? "",
        zoneType,
        rarityCaps: rarityCapsForZoneType(zoneType, lookup),
        boardId: zoneTypeConfig?.boardId ?? null,
        // An absent spawnPointsSet on a known zone type's config defaults to 0, same convention
        // the game's own servers use for any omitted numeric field elsewhere in this response
        // (e.g. a resource's omitted currentAmount meaning 0, not unknown) - confirmed against a
        // real capture (LandingPad2 omits it entirely, and its board does have a real, populated
        // set at index 0). Only an unrevealed site (no zoneTypeConfig entry to look up at all)
        // reads as null - there's nothing to default there.
        spawnPointsSet: zoneTypeConfig ? zoneTypeConfig.spawnPointsSet ?? 0 : null,
        players: lineups1 && lineups2 ? ([lineups1, lineups2] as [GuildWarLineup[], GuildWarLineup[]]) : null,
      };
    }),
  );
}

// Extracts the two 5x3 guild war battlefields - what the player's guild is attacking (the other
// guild's board) and defending (their own board) - from a GET_PLAYER response's hero object.
// Returns both as null when no guild war is currently active, rather than an empty 5x3 grid of
// nulls that would look like a revealed-but-empty board.
export function extractGuildWar(hero: any): GuildWarData {
  const module = findGuildWarModule(hero);
  if (!module) return { attack: null, defense: null };

  // personalState.teamIndex (1 or 2) says which of team1/team2 is the player's own guild -
  // confirmed against a real capture by cross-referencing the player's own display name against
  // team2.guildWarGuildData.members, which matched teamIndex exactly.
  const myTeamIndex = module.personalState?.teamIndex;
  const myTeam = myTeamIndex === 1 ? module.team1 : myTeamIndex === 2 ? module.team2 : null;
  const theirTeam = myTeamIndex === 1 ? module.team2 : myTeamIndex === 2 ? module.team1 : null;

  const lookup = buildSiteConfigLookup(module);

  return {
    attack: toBattlefield(theirTeam?.defendingFrontLine?.warZones, lookup),
    defense: toBattlefield(myTeam?.defendingFrontLine?.warZones, lookup),
  };
}

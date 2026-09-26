import characterData from "../assets/character-data.json";
import abilityData from "../assets/ability-data.json";
import itemData from "../assets/character-power-items.json";

interface AttackProfile {
  pierce: string;
  hitCount: number;
  range?: number;
}

interface CharacterData {
  id: string;
  name: string;
  traits: string[];
  alliance: string;
  faction: string;
  meleeAttack: AttackProfile;
  rangedAttack?: AttackProfile;
  activeAbilityId: string;
  passiveAbilityIds: string;
}

interface AbilityData {
  id: string;
  constants?: Record<string, string>;
}

interface ItemConfig {
  abilityId?: string;
}

const characterById = new Map((characterData as CharacterData[]).map((c) => [c.id, c]));
const abilityById = new Map((abilityData as AbilityData[]).map((a) => [a.id, a]));
const itemConfigById = itemData as Record<string, ItemConfig>;

const DAMAGE_PROFILE_KEYS = ["damageProfile", "damageProfile_2", "damageProfile_3"];

export interface CharacterProfile {
  name: string;
  damageProfiles: string[];
  traits: string[];
  alliance: string;
  faction: string;
  hasRangedAttack: boolean;
}

function addDamageProfilesFrom(profiles: Set<string>, ability: AbilityData): void {
  for (const key of DAMAGE_PROFILE_KEYS) {
    const profile = ability.constants?.[key];
    if (profile) {
      profiles.add(profile);
    }
  }
}

function addAbilityDamageProfiles(profiles: Set<string>, abilityId: string): void {
  const ability = abilityById.get(abilityId);
  if (!ability) {
    throw new Error(`Unknown ability id: ${abilityId}`);
  }
  addDamageProfilesFrom(profiles, ability);
}

// A relic's ability can add damage of a type the bearer doesn't natively deal (e.g. Orbs of Decay
// gives Rotbone extra Toxic hits on top of his Power melee), which makes him eligible for ops that
// require that damage type. `equipped` is a unit's `items` (slot -> instance id) and `playerItems`
// is player.hero.items.items (instance id -> { itemId, ... }). Unlike the all-or-nothing power
// calculation, this never throws - an unknown instance/item/ability is just skipped, so the worst
// case is exactly the old behavior (no extra profiles).
export function equippedRelicDamageProfiles(equipped: unknown, playerItems: unknown): string[] {
  if (typeof equipped !== "object" || equipped === null) return [];
  if (typeof playerItems !== "object" || playerItems === null) return [];

  const profiles = new Set<string>();
  for (const instanceId of Object.values(equipped)) {
    if (typeof instanceId !== "number" && typeof instanceId !== "string") continue;
    const instance = (playerItems as Record<string, { itemId?: unknown } | undefined>)[String(instanceId)];
    if (typeof instance?.itemId !== "string") continue;
    const abilityId = itemConfigById[instance.itemId]?.abilityId;
    const ability = abilityId ? abilityById.get(abilityId) : undefined;
    if (ability) addDamageProfilesFrom(profiles, ability);
  }
  return [...profiles];
}

// extraDamageProfiles are the player's own additions (see equippedRelicDamageProfiles) - omitted
// for anything that isn't evaluating a specific player's unit, like the static coverage catalog.
export function getCharacterProfile(characterId: string, extraDamageProfiles: readonly string[] = []): CharacterProfile {
  const character = characterById.get(characterId);
  if (!character) {
    throw new Error(`Unknown character id: ${characterId}`);
  }

  const damageProfiles = new Set<string>();
  damageProfiles.add(character.meleeAttack.pierce);
  if (character.rangedAttack) {
    damageProfiles.add(character.rangedAttack.pierce);
  }
  addAbilityDamageProfiles(damageProfiles, character.activeAbilityId);
  addAbilityDamageProfiles(damageProfiles, character.passiveAbilityIds);
  for (const profile of extraDamageProfiles) {
    damageProfiles.add(profile);
  }

  return {
    name: character.name,
    damageProfiles: [...damageProfiles],
    traits: character.traits,
    alliance: character.alliance,
    faction: character.faction,
    hasRangedAttack: character.rangedAttack !== undefined,
  };
}

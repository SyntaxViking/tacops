// Ported from a friend's zero-dependency characterPower.mjs (~/Downloads/character-power/) - same
// algorithm and the same defensive runtime validation, just typed. The validation is a feature, not
// incidental strictness: it loudly throws when the bundled GameConfig data doesn't match the
// response's unit IDs (e.g. a unit added after the last extraction), rather than silently returning
// a believable-but-wrong power number.
//
// Covers both characters and Machines of War. A character's power comes from the health/damage/armor
// stat formula plus active/passive ability power and (when equipped) relic ability power. A Machine
// of War skips the stat formula entirely: its power is its primary, secondary, and - once unlocked -
// mythic ability power, scaled by the same trait/progression modifiers.

import units from "../assets/character-power-units.json";
import items from "../assets/character-power-items.json";
import upgrades from "../assets/character-power-upgrades.json";

export interface CharacterPower {
  unitId: string;
  name: string;
  power: number;
}

export interface UnitPower extends CharacterPower {
  type: "character" | "machineOfWar";
}

/**
 * Calculates power for every owned unit (characters and Machines of War) using the GameConfig subset
 * bundled at build time (see README.md's "Updating character-power data" - the extraction now lives
 * in datamine_tacticus's extract_all.ts as the character_power job). Throws under the same
 * conditions as calculateUnitPowers - most commonly when `response` contains a unit added since the
 * bundled data was last extracted.
 */
export function calculateBundledUnitPowers(response: unknown): UnitPower[] {
  return calculateUnitPowers(response, { units, items, upgrades });
}

/** As calculateBundledUnitPowers, but per-unit failures are reported instead of thrown. */
export function calculateBundledUnitPowersLenient(response: unknown): { powers: UnitPower[]; failures: UnitPowerFailure[] } {
  return calculateUnitPowersLenient(response, { units, items, upgrades });
}

/** As calculateBundledUnitPowers, but Machines of War are filtered out and `type` is stripped. */
export function calculateBundledCharacterPowers(response: unknown): CharacterPower[] {
  return stripMachines(calculateBundledUnitPowers(response));
}

interface Stats {
  health: number;
  damage: number;
  fixedArmor: number;
  critChance: number;
  critDamage: number;
  blockChance: number;
  blockDamage: number;
  critChanceBonus: number;
  critDamageBonus: number;
  blockChanceBonus: number;
  blockDamageBonus: number;
}

interface CharacterStats {
  stats: Stats;
  // The level of the equipped relic's granted ability, or null when no relic is equipped.
  relicAbilityLevel: number | null;
}

type JsonObject = Record<string, unknown>;

/**
 * Calculates the in-game power of every owned unit in a CONNECT response.
 *
 * `gameConfigDocument` is the parsed contents of GameConfig.json (or just its `clientGameConfig`
 * value). Results are sorted by descending power, tiebroken by unit ID.
 */
export function calculateUnitPowers(response: unknown, gameConfigDocument: unknown): UnitPower[] {
  const { powers, failures } = calculateUnitPowersLenient(response, gameConfigDocument);
  if (failures.length > 0) {
    // Same error the strict calculation has always thrown: a unit missing from the bundled config
    // is reported by name; any other per-unit failure surfaces its own error.
    const missing = failures.filter((failure) => failure.missingFromConfig).map((failure) => failure.unitId);
    if (missing.length > 0) throw new Error(`GameConfig has no lineup definition for: ${missing.join(", ")}`);
    throw failures[0].error;
  }
  return powers;
}

export interface UnitPowerFailure {
  unitId: string;
  // True when the unit isn't in the bundled GameConfig at all (a unit added since the last
  // extraction) rather than being present but failing validation.
  missingFromConfig: boolean;
  error: Error;
}

/**
 * As calculateUnitPowers, but a unit whose power can't be calculated is reported in `failures` and
 * left out of `powers`, instead of throwing away every other unit's result along with it. Problems
 * with the response or GameConfig as a whole (no hero state, no units config, ...) still throw.
 */
export function calculateUnitPowersLenient(
  response: unknown,
  gameConfigDocument: unknown,
): { powers: UnitPower[]; failures: UnitPowerFailure[] } {
  const hero = findHeroState(response);
  const gameConfig = unwrapGameConfig(gameConfigDocument);
  const unitsConfig = objectAt(gameConfig, "units");
  const lineup = objectAt(unitsConfig, "lineup");
  const playerUnits = objectAt(objectAt(hero, "units"), "units");
  const playerItems = objectAt(objectAt(hero, "items"), "items");
  const itemConfigs = objectAt(gameConfig, "items");
  const upgradeConfigs = objectAt(gameConfig, "upgrades");
  const powers: UnitPower[] = [];
  const failures: UnitPowerFailure[] = [];

  for (const [unitId, rawProgress] of Object.entries(playerUnits)) {
    if (optionalObject(lineup[unitId]) === null) {
      failures.push({ unitId, missingFromConfig: true, error: new Error(`GameConfig has no lineup definition for: ${unitId}`) });
      continue;
    }
    try {
      const progress = requireObject(rawProgress, `units.${unitId}`);
      const unit = requireObject(lineup[unitId], `GameConfig.units.lineup.${unitId}`);
      const traits = stringArray(unit.traits, `${unitId}.traits`);
      const isMachine = traits.includes("MachineOfWar");

      // Snowprint omits numeric fields whose value is zero.
      const progressionIndex = integerOrDefault(progress.progressionIndex, 0, `units.${unitId}.progressionIndex`);
      const progressionStep = getProgressionStep(unitsConfig, unitId, progressionIndex, isMachine);

      let power: number;
      if (isMachine) {
        power = calculateMachinePower(unit, progress, progressionStep, unitsConfig);
      } else {
        const { stats, relicAbilityLevel } = calculateStats(
          unitId,
          unit,
          progress,
          progressionStep,
          playerItems,
          itemConfigs,
          upgradeConfigs,
        );
        power = calculatePower(unit, progress, progressionStep, stats, relicAbilityLevel, unitsConfig);
      }

      powers.push({
        unitId,
        name: typeof unit.name === "string" ? unit.name : unitId,
        power,
        type: isMachine ? "machineOfWar" : "character",
      });
    } catch (error) {
      failures.push({ unitId, missingFromConfig: false, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }

  powers.sort((a, b) => b.power - a.power || a.unitId.localeCompare(b.unitId));
  return { powers, failures };
}

/** As calculateUnitPowers, but Machines of War are filtered out and `type` is stripped. */
export function calculateCharacterPowers(response: unknown, gameConfigDocument: unknown): CharacterPower[] {
  return stripMachines(calculateUnitPowers(response, gameConfigDocument));
}

function stripMachines(powers: UnitPower[]): CharacterPower[] {
  return powers.filter((unit) => unit.type === "character").map(({ unitId, name, power }) => ({ unitId, name, power }));
}

function calculateStats(
  unitId: string,
  unit: JsonObject,
  progress: JsonObject,
  progressionStep: JsonObject,
  playerItems: JsonObject,
  itemConfigs: JsonObject,
  upgradeConfigs: JsonObject,
): CharacterStats {
  const base = objectAt(unit, "stats");
  const stats = emptyStats();
  stats.health = numberOrZero(base.Health);
  stats.damage = numberOrZero(base.Damage);
  stats.fixedArmor = numberOrZero(base.FixedArmor);
  stats.critChance = numberOrZero(base.CritChance);
  stats.critDamage = numberOrZero(base.CritDamage);
  stats.blockChance = numberOrZero(base.BlockChance);
  stats.blockDamage = numberOrZero(base.BlockDamage);

  // Snowprint omits numeric fields whose value is zero.
  const rank = integerOrDefault(progress.rank, 0, `units.${unitId}.rank`);
  const upgradeRows = nestedStringArrays(unit.upgrades, `${unitId}.upgrades`);
  const increaseRows = nestedNumberArrays(unit.upgradesStatIncrease, `${unitId}.upgradesStatIncrease`);
  for (let completedRank = 0; completedRank < rank; completedRank += 1) {
    addUpgradeRow(stats, upgradeRows[completedRank], increaseRows[completedRank], upgradeConfigs, unitId);
  }

  const multiplier = integerAt(progressionStep, "unitStatMultiplierPct", `${unitId}.progressionStep`);
  stats.health = Math.trunc((stats.health * multiplier) / 100);
  stats.damage = Math.trunc((stats.damage * multiplier) / 100);
  stats.fixedArmor = Math.trunc((stats.fixedArmor * multiplier) / 100);

  const applied = numberArrayOrEmpty(progress.upgrades).map((value) => Math.trunc(value));
  for (const index of applied) {
    const upgradeId = upgradeRows[rank]?.[index];
    const increase = increaseRows[rank]?.[index];
    if (upgradeId === undefined || increase === undefined) {
      throw new Error(`Invalid current-rank upgrade ${index} for ${unitId}`);
    }
    addUpgrade(stats, upgradeId, increase, upgradeConfigs, unitId);
  }

  const { stats: itemStats, relicAbilityLevel } = calculateItemStats(progress.items, playerItems, itemConfigs, unitId);
  mergeStats(stats, itemStats);
  return { stats, relicAbilityLevel };
}

function calculateItemStats(
  rawEquipped: unknown,
  playerItems: JsonObject,
  itemConfigs: JsonObject,
  unitId: string,
): CharacterStats {
  const result = emptyStats();
  let relicAbilityLevel: number | null = null;
  const equipped = optionalObject(rawEquipped) ?? {};
  for (const instanceId of Object.values(equipped)) {
    if (typeof instanceId !== "number" && typeof instanceId !== "string") {
      throw new Error(`Invalid equipped item reference for ${unitId}`);
    }
    const instance = requireObject(playerItems[String(instanceId)], `items.${String(instanceId)}`);
    const itemId = stringAt(instance, "itemId", `items.${String(instanceId)}`);
    const level = integerAt(instance, "level", `items.${String(instanceId)}`);
    const item = requireObject(itemConfigs[itemId], `GameConfig.items.${itemId}`);
    if (typeof item.abilityId === "string" && item.abilityId.length > 0) {
      relicAbilityLevel = level;
    }
    if (!Array.isArray(item.levels)) {
      throw new Error(`GameConfig item ${itemId} has no levels`);
    }
    const levelConfig = requireObject(item.levels[level - 1], `GameConfig.items.${itemId}.levels[${level - 1}]`);
    const rawStats = objectAt(levelConfig, "stats");
    result.health += numberOrZero(rawStats.hp);
    result.damage += numberOrZero(rawStats.dmg);
    result.fixedArmor += numberOrZero(rawStats.fixedArmor);
    result.critChance = stackChance(result.critChance, numberOrZero(rawStats.critChance));
    result.critDamage += numberOrZero(rawStats.critDmg);
    result.blockChance = stackChance(result.blockChance, numberOrZero(rawStats.blockChance));
    result.blockDamage += numberOrZero(rawStats.blockDmg);
    result.critChanceBonus = stackChance(result.critChanceBonus, numberOrZero(rawStats.critChanceBonus));
    result.critDamageBonus += numberOrZero(rawStats.critDmgBonus);
    result.blockChanceBonus = stackChance(result.blockChanceBonus, numberOrZero(rawStats.blockChanceBonus));
    result.blockDamageBonus += numberOrZero(rawStats.blockDmgBonus);
  }
  if (result.critChance > 0) result.critChance += result.critChanceBonus;
  if (result.critDamage > 0) result.critDamage += result.critDamageBonus;
  if (result.blockChance > 0) result.blockChance += result.blockChanceBonus;
  if (result.blockDamage > 0) result.blockDamage += result.blockDamageBonus;
  return { stats: result, relicAbilityLevel };
}

function calculatePower(
  unit: JsonObject,
  progress: JsonObject,
  progressionStep: JsonObject,
  stats: Stats,
  relicAbilityLevel: number | null,
  unitsConfig: JsonObject,
): number {
  const damageModifiers = objectAt(unitsConfig, "damageProfileModifiers");
  const weapons = arrayOfObjects(unit.weapons, "unit.weapons");
  let squaredWeaponPower = 0;
  for (const weapon of weapons) {
    const hits = integerAt(weapon, "hits", "unit.weapon");
    const profile = stringAt(weapon, "DamageProfile", "unit.weapon");
    const baseDamage = hits * stats.damage;
    const criticalDamage = stats.critDamage * geometricPartial(stats.critChance / 100, hits);
    const profileModifier = numberAt(damageModifiers, profile, "units.damageProfileModifiers");
    const rangeModifier = weapon.Range === undefined ? 0.9 : Math.sqrt(numberOrZero(weapon.Range));
    const weaponPower = (baseDamage + criticalDamage) * (profileModifier / 100) * rangeModifier;
    squaredWeaponPower += weaponPower * weaponPower;
  }
  const weaponsPower = Math.sqrt(squaredWeaponPower);

  const expectedBlock = 3 * stats.blockDamage * geometricPartial(stats.blockChance / 100, 3);
  const durability = (stats.health + expectedBlock) * (1 + stats.fixedArmor / 2);
  const statsPower = Math.pow(durability * weaponsPower, 2 / 3);

  const abilityCurves = objectAt(unitsConfig, "abilityPowerCurve");
  const activeCurve = numberArrayAt(abilityCurves, "active", "units.abilityPowerCurve");
  const passiveCurve = numberArrayAt(abilityCurves, "passive", "units.abilityPowerCurve");
  const abilityModifiers = objectAt(unitsConfig, "abilityPowerModifiers");
  const activeId = stringArray(unit.activeAbilities, "unit.activeAbilities")[0];
  const passiveId = stringArray(unit.passiveAbilities, "unit.passiveAbilities")[0];
  if (!activeId || !passiveId) {
    throw new Error("Character must have one active and one passive ability");
  }
  const activeLevel = integerAt(progress, "active", "unit.progress");
  const passiveLevel = integerAt(progress, "passive", "unit.progress");
  const activePower = abilityPower(activeId, activeLevel, activeCurve, abilityModifiers);
  const passivePower = abilityPower(passiveId, passiveLevel, passiveCurve, abilityModifiers);
  const abilityMultiplier = integerAt(progressionStep, "abilityPowerMultiplier", "unit.progressionStep");
  const abilitiesPower = (activePower + passivePower) * abilityMultiplier;
  const relicPower =
    relicAbilityLevel === null
      ? 0
      : abilityCurvePower(relicAbilityLevel, numberArrayAt(abilityCurves, "relic", "units.abilityPowerCurve"), "unit.relicAbility");

  const traitMultiplier = calculateTraitMultiplier(unit, unitsConfig);
  const movement = numberAt(unit, "Movement", "unit");
  const unitPowerMultiplier = typeof unit.powerMultiplier === "number" ? unit.powerMultiplier : 100;
  const rawPower =
    (10 + traitMultiplier * ((statsPower * Math.sqrt(movement)) / 100 + abilitiesPower + relicPower)) *
    (unitPowerMultiplier / 100);
  return Math.round(rawPower);
}

function calculateMachinePower(
  unit: JsonObject,
  progress: JsonObject,
  progressionStep: JsonObject,
  unitsConfig: JsonObject,
): number {
  const abilityIds = stringArray(unit.activeAbilities, "machineOfWar.activeAbilities");
  const primaryId = abilityIds[0];
  const secondaryId = abilityIds[1];
  if (!primaryId || !secondaryId) {
    throw new Error("Machine of War must have a primary and secondary ability");
  }

  const abilityCurves = objectAt(unitsConfig, "abilityPowerCurve");
  const primaryCurve = numberArrayAt(abilityCurves, "active", "units.abilityPowerCurve");
  const secondaryCurve = numberArrayAt(abilityCurves, "passive", "units.abilityPowerCurve");
  const abilityModifiers = objectAt(unitsConfig, "abilityPowerModifiers");
  const primaryLevel = integerAt(progress, "active", "machineOfWar.progress");
  const secondaryLevel = integerAt(progress, "passive", "machineOfWar.progress");
  const primaryPower = abilityPower(primaryId, primaryLevel, primaryCurve, abilityModifiers);
  const secondaryPower = abilityPower(secondaryId, secondaryLevel, secondaryCurve, abilityModifiers);

  const abilityMultiplier = integerAt(progressionStep, "abilityPowerMultiplier", "machineOfWar.progressionStep");
  const mythicPower = numberOrZero(progressionStep.mythicAbilityPower);

  const traitMultiplier = calculateTraitMultiplier(unit, unitsConfig);
  const unitPowerMultiplier = typeof unit.powerMultiplier === "number" ? unit.powerMultiplier : 100;
  const rawPower =
    (10 + traitMultiplier * ((primaryPower + secondaryPower) * abilityMultiplier + mythicPower)) *
    (unitPowerMultiplier / 100);
  return Math.round(rawPower);
}

function calculateTraitMultiplier(unit: JsonObject, unitsConfig: JsonObject): number {
  const traitModifiers = objectAt(unitsConfig, "traitPowerModifiers");
  let multiplier = 1;
  for (const trait of stringArray(unit.traits, "unit.traits")) {
    const modifier = traitModifiers[trait];
    if (typeof modifier === "number") {
      multiplier *= modifier / 100;
    }
  }
  return multiplier;
}

function abilityPower(abilityId: string, level: number, curve: number[], modifiers: JsonObject): number {
  if (level < 1) return 0;
  const base = curve[level - 1];
  if (base === undefined) {
    throw new Error(`Ability level ${level} is outside the power curve`);
  }
  const modifier = optionalObject(modifiers[abilityId]);
  return base * (modifier ? numberOrDefault(modifier.baseMultiplier, 100) / 100 : 1);
}

function abilityCurvePower(level: number, curve: number[], field: string): number {
  if (level < 1) return 0;
  const base = curve[level - 1];
  if (base === undefined || !Number.isFinite(base)) {
    throw new Error(`${field} level ${level} is outside the power curve`);
  }
  return base;
}

function getProgressionStep(
  unitsConfig: JsonObject,
  unitId: string,
  progressionIndex: number,
  isMachine: boolean,
): JsonObject {
  if (isMachine) {
    const steps = unitsConfig.heroProgressionStepsMoW;
    if (!Array.isArray(steps)) {
      throw new Error(`GameConfig has no Machine of War progression steps for ${unitId}`);
    }
    return requireObject(steps[progressionIndex], `${unitId}.machineProgressionStep`);
  }

  const perUnit = objectAt(unitsConfig, "heroProgressionStepsPerUnit");
  const defaults = (perUnit.default as unknown) ?? unitsConfig.heroProgressionSteps;
  if (!Array.isArray(defaults)) {
    throw new Error(`GameConfig has no progression steps for ${unitId}`);
  }
  const defaultStep = requireObject(defaults[progressionIndex], `${unitId}.defaultProgressionStep`);
  const overrides = perUnit[unitId];
  if (overrides === undefined) {
    return defaultStep;
  }
  if (!Array.isArray(overrides)) {
    throw new Error(`GameConfig progression override for ${unitId} must be an array`);
  }
  const override = requireObject(overrides[progressionIndex], `${unitId}.progressionStepOverride`);
  return { ...defaultStep, ...override };
}

function addUpgradeRow(stats: Stats, ids: string[] | undefined, increases: number[] | undefined, upgradeConfigs: JsonObject, unitId: string): void {
  if (!ids || !increases || ids.length !== increases.length) {
    throw new Error(`Invalid upgrade row for ${unitId}`);
  }
  ids.forEach((id, index) => {
    const increase = increases[index];
    if (increase === undefined) {
      throw new Error(`Missing upgrade stat increase for ${unitId}`);
    }
    addUpgrade(stats, id, increase, upgradeConfigs, unitId);
  });
}

function addUpgrade(stats: Stats, upgradeId: string, increase: number, upgradeConfigs: JsonObject, unitId: string): void {
  const config = requireObject(upgradeConfigs[upgradeId], `GameConfig.upgrades.${upgradeId}`);
  switch (stringAt(config, "statType", `upgrade ${upgradeId}`)) {
    case "hp":
      stats.health += increase;
      break;
    case "dmg":
      stats.damage += increase;
      break;
    case "fixedArmor":
      stats.fixedArmor += increase;
      break;
    default:
      throw new Error(`Unsupported upgrade stat on ${upgradeId} for ${unitId}`);
  }
}

function mergeStats(target: Stats, source: Stats): void {
  target.health += source.health;
  target.damage += source.damage;
  target.fixedArmor += source.fixedArmor;
  target.critChance += source.critChance;
  target.critDamage += source.critDamage;
  target.blockChance += source.blockChance;
  target.blockDamage += source.blockDamage;
}

function stackChance(current: number, added: number): number {
  return current + Math.trunc((1 - current / 100) * added);
}

function geometricPartial(ratio: number, terms: number): number {
  let sum = 0;
  let term = ratio;
  for (let index = 0; index < terms; index += 1) {
    sum += term;
    term *= ratio;
  }
  return sum;
}

function emptyStats(): Stats {
  return {
    health: 0,
    damage: 0,
    fixedArmor: 0,
    critChance: 0,
    critDamage: 0,
    blockChance: 0,
    blockDamage: 0,
    critChanceBonus: 0,
    critDamageBonus: 0,
    blockChanceBonus: 0,
    blockDamageBonus: 0,
  };
}

function findHeroState(response: unknown): JsonObject {
  const root = requireObject(response, "response");
  const eventResult = optionalObject(root.eventResult);
  const data = optionalObject(eventResult?.eventResponseData);
  const connectHero = optionalObject(optionalObject(data?.player)?.hero);
  if (connectHero) return connectHero;
  const heroInfo = optionalObject(data?.heroInfo);
  if (heroInfo) return heroInfo;
  const directHero = optionalObject(optionalObject(root.player)?.hero);
  if (directHero) return directHero;
  throw new Error("Response does not contain a supported player hero state");
}

function unwrapGameConfig(value: unknown): JsonObject {
  const root = requireObject(value, "GameConfig");
  return optionalObject(root.clientGameConfig) ?? root;
}

function objectAt(value: JsonObject, key: string): JsonObject {
  return requireObject(value[key], key);
}

function optionalObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function requireObject(value: unknown, field: string): JsonObject {
  const object = optionalObject(value);
  if (!object) {
    throw new Error(`${field} must be an object`);
  }
  return object;
}

function integerAt(value: JsonObject, key: string, field: string): number {
  const number = numberAt(value, key, field);
  if (!Number.isInteger(number)) {
    throw new Error(`${field}.${key} must be an integer`);
  }
  return number;
}

function integerOrDefault(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  return value;
}

function numberAt(value: JsonObject, key: string, field: string): number {
  const number = value[key];
  if (typeof number !== "number" || !Number.isFinite(number)) {
    throw new Error(`${field}.${key} must be a finite number`);
  }
  return number;
}

function stringAt(value: JsonObject, key: string, field: string): string {
  const string = value[key];
  if (typeof string !== "string") {
    throw new Error(`${field}.${key} must be a string`);
  }
  return string;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be a string array`);
  }
  return value;
}

function numberArrayAt(value: JsonObject, key: string, field: string): number[] {
  const array = value[key];
  if (!Array.isArray(array) || !array.every((item) => typeof item === "number")) {
    throw new Error(`${field}.${key} must be a number array`);
  }
  return array;
}

function numberArrayOrEmpty(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number")) {
    throw new Error("Expected a number array");
  }
  return value;
}

function nestedStringArrays(value: unknown, field: string): string[][] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((row, index) => stringArray(row, `${field}[${index}]`));
}

function nestedNumberArrays(value: unknown, field: string): number[][] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((row, index) => {
    if (!Array.isArray(row) || !row.every((item) => typeof item === "number")) {
      throw new Error(`${field}[${index}] must be a number array`);
    }
    return row;
  });
}

function arrayOfObjects(value: unknown, field: string): JsonObject[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((item, index) => requireObject(item, `${field}[${index}]`));
}

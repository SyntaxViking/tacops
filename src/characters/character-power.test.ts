import { describe, expect, it } from "vitest";
import { calculateCharacterPowers, calculateUnitPowers, calculateUnitPowersLenient } from "./character-power";

function gameConfig(overrides: { unit?: Record<string, unknown>; items?: Record<string, unknown> } = {}) {
  return {
    units: {
      lineup: {
        testUnit: {
          name: "Test Unit",
          traits: [],
          weapons: [{ hits: 1, DamageProfile: "Bolter" }],
          activeAbilities: ["activeA"],
          passiveAbilities: ["passiveA"],
          Movement: 16,
          stats: { Health: 100, Damage: 10 },
          upgrades: [],
          upgradesStatIncrease: [],
          ...overrides.unit,
        },
      },
      heroProgressionSteps: [{ unitStatMultiplierPct: 100, abilityPowerMultiplier: 100 }],
      heroProgressionStepsPerUnit: {},
      heroProgressionStepsMoW: [{ abilityPowerMultiplier: 100 }],
      damageProfileModifiers: { Bolter: 100 },
      abilityPowerCurve: { active: [10, 20], passive: [5, 15], relic: [100, 200] },
      abilityPowerModifiers: {},
      traitPowerModifiers: {},
    },
    items: overrides.items ?? {},
    upgrades: {},
  };
}

function response(progress: Record<string, unknown> = {}, playerItems: Record<string, unknown> = {}) {
  return {
    player: {
      hero: {
        units: {
          units: {
            testUnit: { progressionIndex: 0, rank: 0, active: 2, passive: 2, upgrades: [], ...progress },
          },
        },
        items: { items: playerItems },
      },
    },
  };
}

describe("calculateCharacterPowers", () => {
  it("matches the reference implementation's output for a hand-built fixture", () => {
    // Pins the ported algorithm against the original characterPower.mjs - this exact number was
    // captured by running the same fixture through both implementations.
    const result = calculateCharacterPowers(response(), gameConfig());

    expect(result).toEqual([{ unitId: "testUnit", name: "Test Unit", power: 3514 }]);
  });

  it("gives a higher-rank character more power than an otherwise-identical lower-rank one", () => {
    const lowRank = calculateCharacterPowers(response({ rank: 0 }), gameConfig())[0];
    const highRankConfig = gameConfig({
      unit: {
        upgrades: [["hpUpgrade"]],
        upgradesStatIncrease: [[50]],
      },
    });
    const highRank = calculateCharacterPowers(response({ rank: 1 }), {
      ...highRankConfig,
      upgrades: { hpUpgrade: { statType: "hp" } },
    })[0];

    expect(highRank.power).toBeGreaterThan(lowRank.power);
  });

  it("adds equipped relic ability power on top of the base character power", () => {
    const withoutRelic = calculateCharacterPowers(response(), gameConfig())[0];
    const withRelic = calculateCharacterPowers(
      response({ items: { slot1: "inst1" } }, { inst1: { itemId: "relicA", level: 2 } }),
      gameConfig({ items: { relicA: { abilityId: "relicAbilityA", levels: [{ stats: {} }, { stats: {} }] } } }),
    )[0];

    expect(withRelic.power).toBeGreaterThan(withoutRelic.power);
  });

  it("omits Machines of War", () => {
    const result = calculateCharacterPowers(
      response(),
      gameConfig({ unit: { traits: ["MachineOfWar"], activeAbilities: ["activeA", "passiveA"] } }),
    );

    expect(result).toEqual([]);
  });

  it("throws when the response references a unit missing from the bundled config", () => {
    const withUnknownUnit = response();
    (withUnknownUnit.player.hero.units.units as Record<string, unknown>).unknownUnit = {
      progressionIndex: 0,
      rank: 0,
      active: 1,
      passive: 1,
    };

    expect(() => calculateCharacterPowers(withUnknownUnit, gameConfig())).toThrow(/unknownUnit/);
  });
});

describe("calculateUnitPowers", () => {
  it("scores a Machine of War from its ability power and tags it as such", () => {
    const result = calculateUnitPowers(
      response(),
      gameConfig({ unit: { traits: ["MachineOfWar"], activeAbilities: ["activeA", "passiveA"] } }),
    );

    expect(result).toEqual([{ unitId: "testUnit", name: "Test Unit", power: 3510, type: "machineOfWar" }]);
  });

  it("tags characters as characters", () => {
    const result = calculateUnitPowers(response(), gameConfig());

    expect(result).toEqual([{ unitId: "testUnit", name: "Test Unit", power: 3514, type: "character" }]);
  });
});

describe("calculateUnitPowersLenient", () => {
  function responseWithExtraUnit(extraId: string) {
    const base = response() as any;
    base.player.hero.units.units[extraId] = { progressionIndex: 0, rank: 0, active: 2, passive: 2, upgrades: [] };
    return base;
  }

  it("reports a unit missing from the GameConfig without losing the other units' powers", () => {
    const { powers, failures } = calculateUnitPowersLenient(responseWithExtraUnit("brandNewUnit"), gameConfig());

    expect(powers.map((p) => p.unitId)).toEqual(["testUnit"]);
    expect(powers[0].power).toBe(3514);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ unitId: "brandNewUnit", missingFromConfig: true });
  });

  it("reports a unit whose own data is invalid, as a failure that isn't 'missing from config'", () => {
    const { powers, failures } = calculateUnitPowersLenient(response({ rank: "bad" }), gameConfig());

    expect(powers).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ unitId: "testUnit", missingFromConfig: false });
  });

  it("leaves the strict calculation throwing for a missing unit", () => {
    expect(() => calculateUnitPowers(responseWithExtraUnit("brandNewUnit"), gameConfig())).toThrow(
      "GameConfig has no lineup definition for: brandNewUnit",
    );
  });
});

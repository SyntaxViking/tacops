import { describe, expect, it } from "vitest";
import { extractPlanetDefenses } from "./planet-defenses-extraction";

function heroWithPlanetsData(planetsData: any[]) {
  return {
    liveEvents: {
      liveEvents: [
        {
          modules: [
            { type: "crusadeEvent", module: { planetsData } },
          ],
        },
      ],
    },
  };
}

describe("extractPlanetDefenses", () => {
  it("computes imperial and devastation counts from the real PlanetaryDefenses buff shape", () => {
    const hero = heroWithPlanetsData([
      {
        planetId: "planet_001",
        buffs: [
          { type: "PlanetaryDefenses", source: "PlanetaryDefenses", side: "For", defensePoints: 630000 },
          { type: "PlanetaryDefenses", source: "PlanetaryDefenses", side: "Against", defensePoints: 841000 },
        ],
      },
    ]);

    expect(extractPlanetDefenses(hero)).toEqual({
      planet_001: { imperial: 6, devastation: 8 },
    });
  });

  it("floors an off-multiple value (legacy 1000-point defenses mixed into the total)", () => {
    const hero = heroWithPlanetsData([
      { planetId: "planet_002", buffs: [{ type: "PlanetaryDefenses", side: "Against", defensePoints: 106000 }] },
    ]);

    expect(extractPlanetDefenses(hero)).toEqual({
      planet_002: { imperial: 0, devastation: 1 },
    });
  });

  it("handles a planet with only one side's defenses present", () => {
    const hero = heroWithPlanetsData([{ planetId: "planet_003", buffs: [{ type: "PlanetaryDefenses", side: "For", defensePoints: 315000 }] }]);

    expect(extractPlanetDefenses(hero)).toEqual({
      planet_003: { imperial: 3, devastation: 0 },
    });
  });

  it("omits a planet entirely when it has no PlanetaryDefenses buff on either side", () => {
    const hero = heroWithPlanetsData([
      { planetId: "planet_004", buffs: [{ type: "CaptureCostIncrease", basePct: 20 }] },
      { planetId: "planet_005", buffs: [] },
      { planetId: "planet_006" },
    ]);

    expect(extractPlanetDefenses(hero)).toEqual({});
  });

  it("ignores non-defense buffs mixed in alongside PlanetaryDefenses entries", () => {
    const hero = heroWithPlanetsData([
      {
        planetId: "planet_007",
        buffs: [
          { type: "PointsMultiplier", source: "PlanetAdjacency", pointsMultiplierPct: 5, stacks: 3 },
          { type: "PlanetaryDefenses", side: "For", defensePoints: 105000 },
        ],
      },
    ]);

    expect(extractPlanetDefenses(hero)).toEqual({
      planet_007: { imperial: 1, devastation: 0 },
    });
  });

  it("returns an empty object when the crusade event module is entirely absent", () => {
    expect(extractPlanetDefenses({})).toEqual({});
    expect(extractPlanetDefenses(null)).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { extractGuildWar } from "./guild-war-extraction";

function unit(id: string, extra: Record<string, unknown> = {}) {
  return { unitInfo: { id, ...extra } };
}

function unitWithRemainingHp(id: string, remainingHp: number, extra: Record<string, unknown> = {}) {
  return { unitInfo: { id, ...extra }, remainingHp };
}

function slot(units: ReturnType<typeof unit>[], options: { defeatedByUserId?: string; mow?: ReturnType<typeof unit> } = {}) {
  return {
    defendingUnits: units,
    defendingMachineOfWar: options.mow,
    ...(options.defeatedByUserId !== undefined ? { defeatedByUserId: options.defeatedByUserId } : {}),
  };
}

function part(slots: ReturnType<typeof slot>[]) {
  return { warZoneSlots: slots };
}

function warZoneRow(...zoneTypes: (string | null)[]) {
  return zoneTypes.map((zoneType, i) =>
    zoneType === null
      ? { zoneId: `hidden-${i}` } // the API omits everything but zoneId for unrevealed sites
      : {
          zoneId: `zone-${zoneType}`,
          warZoneType: zoneType,
          zonePart1: part([slot([unit("tauCrisis")])]),
          zonePart2: part([slot([unit("bloodMephiston")])]),
        },
  );
}

function heroWithGuildWar(
  teamIndex: number,
  team1WarZones: unknown[],
  team2WarZones: unknown[],
  battlefieldConfig?: any,
  battlefieldLevel = 5,
  zoneTypeConfigs?: any,
) {
  return {
    liveEvents: {
      liveEvents: [
        {
          type: "event",
          name: "guildWar",
          modules: [
            {
              type: "guildWarEvent",
              module: {
                type: "guildWarEvent",
                moduleType: "guildWarEvent",
                personalState: { teamIndex },
                battlefieldLevel,
                config: {
                  battlefieldConfig: battlefieldConfig ?? { battleFieldLevels: [], zoneTiers: [] },
                  zoneTypeConfigs: zoneTypeConfigs ?? {},
                },
                team1: { defendingFrontLine: { warZones: team1WarZones } },
                team2: { defendingFrontLine: { warZones: team2WarZones } },
              },
            },
          ],
        },
      ],
    },
  };
}

describe("extractGuildWar", () => {
  it("returns both battlefields as null when no guild war module is present", () => {
    expect(extractGuildWar({})).toEqual({ attack: null, defense: null });
    expect(extractGuildWar({ liveEvents: { liveEvents: [] } })).toEqual({ attack: null, defense: null });
  });

  it("maps team2 to defense and team1 to attack when the player is teamIndex 2", () => {
    const team1WarZones = [warZoneRow("Trenches1", "Trenches2", "Trenches3")];
    const team2WarZones = [warZoneRow("Trenches1", "Bunker2", "SupplyDepot")];

    const result = extractGuildWar(heroWithGuildWar(2, team1WarZones, team2WarZones));

    expect(result.attack?.[0].map((s) => s.zoneType)).toEqual(["Trenches1", "Trenches2", "Trenches3"]);
    expect(result.defense?.[0].map((s) => s.zoneType)).toEqual(["Trenches1", "Bunker2", "SupplyDepot"]);
  });

  it("maps team1 to defense and team2 to attack when the player is teamIndex 1", () => {
    const team1WarZones = [warZoneRow("HQ", null, null)];
    const team2WarZones = [warZoneRow("Trenches1", "Trenches2", "Trenches3")];

    const result = extractGuildWar(heroWithGuildWar(1, team1WarZones, team2WarZones));

    expect(result.defense?.[0][0].zoneType).toBe("HQ");
    expect(result.attack?.[0].map((s) => s.zoneType)).toEqual(["Trenches1", "Trenches2", "Trenches3"]);
  });

  it("reads an unrevealed site as fully null instead of throwing", () => {
    const team1WarZones = [warZoneRow("Trenches1", null, null)];
    const team2WarZones = [warZoneRow("Trenches1", "Trenches2", "Trenches3")];

    const result = extractGuildWar(heroWithGuildWar(2, team1WarZones, team2WarZones));

    expect(result.attack?.[0][1]).toEqual({
      zoneId: "hidden-1",
      zoneType: null,
      rarityCaps: null,
      boardId: null,
      spawnPointsSet: null,
      players: null,
    });
  });

  it("marks every character and the machine of war in a fully-defeated lineup as defeated, even without remainingHp", () => {
    const team2WarZones = [
      [
        {
          zoneId: "zone-Trenches1",
          warZoneType: "Trenches1",
          zonePart1: part([
            slot([unit("tauCrisis"), unit("bloodMephiston")], { defeatedByUserId: "some-attacker-id", mow: unit("deathCrawler") }),
          ]),
          zonePart2: part([slot([unitWithRemainingHp("genesPrimus", 500)], { mow: unit("tyranBiovore") })]),
        },
      ],
    ];

    const result = extractGuildWar(heroWithGuildWar(2, [], team2WarZones));

    const defeatedLineup = result.defense?.[0][0].players?.[0][0];
    expect(defeatedLineup?.defeated).toBe(true);
    expect(defeatedLineup?.characters.map((c) => ({ unitId: c.unitId, defeated: c.defeated }))).toEqual([
      { unitId: "tauCrisis", defeated: true },
      { unitId: "bloodMephiston", defeated: true },
    ]);
    expect(defeatedLineup?.machineOfWar).toEqual({ unitId: "deathCrawler", defeated: true });

    const standingLineup = result.defense?.[0][0].players?.[1][0];
    expect(standingLineup?.defeated).toBe(false);
    expect(standingLineup?.characters).toEqual([{ unitId: "genesPrimus", defeated: false, extraDamageProfiles: [] }]);
    expect(standingLineup?.machineOfWar).toEqual({ unitId: "tyranBiovore", defeated: false });
  });

  it("marks an individual character as defeated once its own remainingHp hits 0, independent of its lineup-mates and its machine of war", () => {
    const team2WarZones = [
      [
        {
          zoneId: "zone-Trenches1",
          warZoneType: "Trenches1",
          zonePart1: part([slot([unitWithRemainingHp("tauCrisis", 0), unitWithRemainingHp("bloodMephiston", 250)], { mow: unit("deathCrawler") })]),
          zonePart2: part([slot([unit("genesPrimus")])]),
        },
      ],
    ];

    const result = extractGuildWar(heroWithGuildWar(2, [], team2WarZones));
    const lineup = result.defense?.[0][0].players?.[0][0];

    expect(lineup?.characters.map((c) => ({ unitId: c.unitId, defeated: c.defeated }))).toEqual([
      { unitId: "tauCrisis", defeated: true },
      { unitId: "bloodMephiston", defeated: false },
    ]);
    // The lineup itself isn't cleared, so its machine of war reads as not defeated either, even
    // though one of its characters already is.
    expect(lineup?.machineOfWar?.defeated).toBe(false);
  });

  it("resolves a character's equipped relic ability into extraDamageProfiles", () => {
    const team2WarZones = [
      [
        {
          zoneId: "zone-Trenches1",
          warZoneType: "Trenches1",
          zonePart1: part([slot([unit("deathRotbone", { relicAbilities: [{ abilityId: "OrbsOfDecay", level: 1 }] })])]),
          zonePart2: part([slot([unit("genesPrimus")])]),
        },
      ],
    ];

    const result = extractGuildWar(heroWithGuildWar(2, [], team2WarZones));

    expect(result.defense?.[0][0].players?.[0][0].characters[0].extraDamageProfiles).toEqual(["Toxic"]);
  });

  it("resolves each site's rarity caps via the active battlefield level's zone tier", () => {
    const battlefieldConfig = {
      battleFieldLevels: [
        {
          battlefieldLevel: 5,
          zoneTiers: [{ warZoneType: "Trenches1", zoneTierId: "Veteran" }],
        },
      ],
      zoneTiers: [{ zoneTierId: "Veteran", rarityCaps: ["Epic", "Epic", "Rare", "Rare", "Rare"] }],
    };
    const team2WarZones = [warZoneRow("Trenches1")];

    const result = extractGuildWar(heroWithGuildWar(2, [], team2WarZones, battlefieldConfig, 5));

    expect(result.defense?.[0][0].rarityCaps).toEqual(["Epic", "Epic", "Rare", "Rare", "Rare"]);
  });

  it("falls back to null rarity caps when the zone type has no tier mapping at the active level", () => {
    const team2WarZones = [warZoneRow("Trenches1")];

    const result = extractGuildWar(heroWithGuildWar(2, [], team2WarZones));

    expect(result.defense?.[0][0].rarityCaps).toBeNull();
  });

  it("resolves a site's board thumbnail id and spawn points set from the zone type config", () => {
    const team2WarZones = [warZoneRow("Trenches1")];

    const result = extractGuildWar(
      heroWithGuildWar(2, [], team2WarZones, undefined, 5, { Trenches1: { boardId: "C1_23", spawnPointsSet: 5 } }),
    );

    expect(result.defense?.[0][0].boardId).toBe("C1_23");
    expect(result.defense?.[0][0].spawnPointsSet).toBe(5);
  });

  it("defaults spawn points set to 0 when a known zone type's config omits it (same absent-means-0 convention as RawPvpEncounter)", () => {
    const team2WarZones = [warZoneRow("Trenches1")];

    const result = extractGuildWar(heroWithGuildWar(2, [], team2WarZones, undefined, 5, { Trenches1: { boardId: "C1_23" } }));

    expect(result.defense?.[0][0].spawnPointsSet).toBe(0);
  });

  it("reads spawn points set as null (not 0) for a site whose zone type is unknown - there's no config to default from", () => {
    const team2WarZones = [warZoneRow(null)];

    const result = extractGuildWar(heroWithGuildWar(2, [], team2WarZones));

    expect(result.defense?.[0][0].spawnPointsSet).toBeNull();
  });
});

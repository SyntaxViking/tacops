import { describe, expect, it } from "vitest";
import { getGuildWarCharacterRow, getGuildWarMowRow, rarityIconUrlForCap } from "./guild-war-lineup-view-model";
import { Rarity } from "../rarity/rarity.enum";
import { rarityIconUrl } from "../rarity/rarity-icon";
import type { GuildWarCharacterSlot, GuildWarMachineOfWar } from "../api/types";

function characterSlot(overrides: Partial<GuildWarCharacterSlot> = {}): GuildWarCharacterSlot {
  return { unitId: "deathRotbone", extraDamageProfiles: [], defeated: false, ...overrides };
}

function mowSlot(overrides: Partial<GuildWarMachineOfWar> = {}): GuildWarMachineOfWar {
  return { unitId: "tyranBiovore", defeated: false, ...overrides };
}

describe("rarityIconUrlForCap", () => {
  it("resolves a known rarity name to the same icon the rest of the app uses", () => {
    expect(rarityIconUrlForCap("Epic")).toBe(rarityIconUrl(Rarity.Epic));
  });

  it("returns null for an unknown rarity name instead of throwing", () => {
    expect(rarityIconUrlForCap("NotARealRarity")).toBeNull();
  });
});

describe("getGuildWarCharacterRow", () => {
  it("builds a CharacterRow for a known character, carrying its relic-derived damage profiles through", () => {
    const row = getGuildWarCharacterRow(characterSlot({ extraDamageProfiles: ["Toxic"] }));
    expect(row?.id).toBe("deathRotbone");
    expect(row?.damageProfileIconUrls.length).toBeGreaterThan(0);
  });

  it("returns null instead of throwing for an unrecognized character id", () => {
    expect(getGuildWarCharacterRow(characterSlot({ unitId: "notARealCharacterId" }))).toBeNull();
  });
});

describe("getGuildWarMowRow", () => {
  it("builds a MowRow for a known machine of war", () => {
    const row = getGuildWarMowRow(mowSlot());
    expect(row?.id).toBe("tyranBiovore");
  });

  it("returns null instead of throwing for an unrecognized machine of war id", () => {
    expect(getGuildWarMowRow(mowSlot({ unitId: "notARealMowId" }))).toBeNull();
  });
});

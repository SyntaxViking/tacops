import { describe, expect, it } from "vitest";
import { equippedRelicDamageProfiles, getCharacterProfile } from "./character-profile";

// Shapes copied from a real prod player export: unit.items (slot -> instance id) and
// player.hero.items.items (instance id -> { itemId, level, boundTo }) for deathRotbone.
const rotboneEquipped = { Slot3: 808, Slot2: 904, Slot1: 828 };
const rotbonePlayerItems = {
  "808": { itemId: "R_Booster_Crit_OrbsOfDecay", level: 1, boundTo: "deathRotbone" },
  "828": { itemId: "I_Crit_M006", level: 1, boundTo: "deathRotbone" },
  "904": { itemId: "I_Defensive_M003", level: 1, boundTo: "deathRotbone" },
};

describe("getCharacterProfile with extra damage profiles", () => {
  it("is Power-only on its own for deathRotbone", () => {
    expect(getCharacterProfile("deathRotbone").damageProfiles).toEqual(["Power"]);
  });

  it("adds relic-provided profiles without duplicating ones the character already has", () => {
    expect(getCharacterProfile("deathRotbone", ["Toxic"]).damageProfiles).toEqual(["Power", "Toxic"]);
    expect(getCharacterProfile("deathRotbone", ["Power", "Toxic"]).damageProfiles).toEqual(["Power", "Toxic"]);
  });
});

describe("equippedRelicDamageProfiles", () => {
  it("returns Toxic for Rotbone's real equipped Orbs of Decay relic, ignoring his non-relic items", () => {
    expect(equippedRelicDamageProfiles(rotboneEquipped, rotbonePlayerItems)).toEqual(["Toxic"]);
  });

  it("adds nothing for non-relic items alone", () => {
    expect(equippedRelicDamageProfiles({ Slot1: 828, Slot2: 904 }, rotbonePlayerItems)).toEqual([]);
  });

  it("adds nothing for a relic whose ability has no damage profile (stat-only relic)", () => {
    const items = { "1": { itemId: "R_Crit_RelicBoltPistol", level: 1 } };
    expect(equippedRelicDamageProfiles({ Slot3: 1 }, items)).toEqual([]);
  });

  it("collapses duplicates when two equipped relics add the same profile", () => {
    const items = {
      "1": { itemId: "R_Booster_Crit_OrbsOfDecay", level: 1 },
      "2": { itemId: "R_Booster_Crit_OrbsOfDecay", level: 1 },
    };
    expect(equippedRelicDamageProfiles({ Slot1: 1, Slot2: 2 }, items)).toEqual(["Toxic"]);
  });

  it("accepts instance ids as strings as well as numbers", () => {
    expect(equippedRelicDamageProfiles({ Slot3: "808" }, rotbonePlayerItems)).toEqual(["Toxic"]);
  });

  it("skips unknown instances, unknown items, and malformed input instead of throwing", () => {
    expect(equippedRelicDamageProfiles({ Slot1: 999 }, rotbonePlayerItems)).toEqual([]);
    expect(equippedRelicDamageProfiles({ Slot1: 1 }, { "1": { itemId: "R_Not_A_Real_Item" } })).toEqual([]);
    expect(equippedRelicDamageProfiles({ Slot1: 1 }, { "1": { level: 1 } })).toEqual([]);
    expect(equippedRelicDamageProfiles({ Slot1: null, Slot2: {} }, rotbonePlayerItems)).toEqual([]);
    expect(equippedRelicDamageProfiles(undefined, rotbonePlayerItems)).toEqual([]);
    expect(equippedRelicDamageProfiles(rotboneEquipped, undefined)).toEqual([]);
    expect(equippedRelicDamageProfiles("nope", null)).toEqual([]);
  });
});

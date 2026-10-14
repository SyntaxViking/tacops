import { describe, expect, it } from "vitest";
import {
  getPvpCharacterSlot,
  getPvpEquipmentSlot,
  getPvpMowSlot,
  getPvpOpponentCard,
} from "./pvp-view-model";
import type { RawPvpEncounter, RawPvpItemInstance, RawPvpUnit } from "../api/types";

const itemsById: Record<string, RawPvpItemInstance> = {
  "1": { itemId: "I_Block_C002", level: 3 },
  "2": { itemId: "R_Crit_RelicBoltPistol", level: 1 },
};

describe("getPvpEquipmentSlot", () => {
  it("resolves a filled slot to its item's name/rarity/level", () => {
    const slot = getPvpEquipmentSlot("1", itemsById);
    expect(slot?.itemId).toBe("I_Block_C002");
    expect(slot?.level).toBe(3);
    expect(slot?.frameUrls).toHaveLength(1);
  });

  it("layers both frame tiers for a relic", () => {
    const slot = getPvpEquipmentSlot("2", itemsById);
    expect(slot?.frameUrls).toHaveLength(2);
  });

  it("returns null for an unfilled slot (no instance id)", () => {
    expect(getPvpEquipmentSlot(undefined, itemsById)).toBeNull();
  });

  it("returns null for an instance id with no matching item instance", () => {
    expect(getPvpEquipmentSlot("999", itemsById)).toBeNull();
  });
});

describe("getPvpCharacterSlot", () => {
  it("resolves rank/rarity/stars/ability levels and every equipment slot", () => {
    const unit: RawPvpUnit = {
      progressionIndex: 16,
      rank: 17,
      active: 50,
      passive: 51,
      items: { Slot1: "1", Slot2: "2" },
    };
    const slot = getPvpCharacterSlot("ultraTigurius", unit, itemsById);
    expect(slot.kind).toBe("character");
    expect(slot.activeLevel).toBe(50);
    expect(slot.passiveLevel).toBe(51);
    expect(slot.equipment).toHaveLength(3);
    expect(slot.equipment[0]?.itemId).toBe("I_Block_C002");
    expect(slot.equipment[1]?.itemId).toBe("R_Crit_RelicBoltPistol");
    expect(slot.equipment[2]).toBeNull();
  });

  it("handles a unit with no items at all (every slot empty)", () => {
    const slot = getPvpCharacterSlot("ultraTigurius", { progressionIndex: 0 }, itemsById);
    expect(slot.equipment).toEqual([null, null, null]);
    expect(slot.activeLevel).toBeNull();
    expect(slot.passiveLevel).toBeNull();
  });
});

describe("getPvpMowSlot", () => {
  it("resolves a Machine of War slot with no equipment field", () => {
    const slot = getPvpMowSlot("blackForgefiend", { progressionIndex: 12, active: 10, passive: 20 });
    expect(slot.kind).toBe("mow");
    expect(slot).not.toHaveProperty("equipment");
    expect(slot.activeLevel).toBe(10);
  });
});

describe("getPvpOpponentCard", () => {
  const encounter: RawPvpEncounter = {
    ratingGain: 30,
    ratingLoss: 15,
    boardId: "C1_02",
    spawnPointsSet: 3,
    opponent: {
      userId: "opponent-1",
      displayName: "Some Opponent",
      avatar: "adept_cherub_01",
      avatarFrameId: "frameHalloween2025",
      rating: 1500,
      level: 80,
      position: 42,
      units: {
        units: {
          ultraTigurius: { progressionIndex: 16, rank: 17, active: 50, passive: 51, items: { Slot1: "1" } },
          ultraEliminatorSgt: { progressionIndex: 10, rank: 12 },
          ultraInceptorSgt: { progressionIndex: 10, rank: 12 },
          ultraApothecary: { progressionIndex: 10, rank: 12 },
          ultraCalgar: { progressionIndex: 10, rank: 12 },
          blackForgefiend: { progressionIndex: 12, active: 5, passive: 5 },
        },
        lineup: { pvp: ["ultraTigurius", "ultraEliminatorSgt", "ultraInceptorSgt", "ultraApothecary", "ultraCalgar"] },
        mowLineup: { pvp: "blackForgefiend" },
      },
      items: { items: itemsById },
    },
  };

  it("builds the full card: 5 characters + 1 MoW, in lineup order, avatar/frame resolved", () => {
    const card = getPvpOpponentCard(encounter);
    expect(card.units).toHaveLength(6);
    expect(card.units[0].kind).toBe("character");
    expect(card.units[5].kind).toBe("mow");
    expect(card.lineup).toEqual([
      "ultraTigurius",
      "ultraEliminatorSgt",
      "ultraInceptorSgt",
      "ultraApothecary",
      "ultraCalgar",
    ]);
    expect(card.avatarUrl).not.toBeNull();
    expect(card.avatarFrameUrl).not.toBeNull();
    expect(card.boardId).toBe("C1_02");
    expect(card.spawnPointsSet).toBe(3);
    expect(card.ratingGain).toBe(30);
    expect(card.ratingLoss).toBe(15);
  });

  it("resolves progressionIndex 16 end-to-end to a Mythic rarity icon and a one-blue-star cluster", () => {
    const card = getPvpOpponentCard(encounter);
    const tigurius = card.units[0];
    expect(tigurius.rarityIconUrl).toContain("mythic");
    expect(tigurius.starIconUrls).toHaveLength(1);
  });

  it("defaults spawnPointsSet to 0 when the field is absent (confirmed real API behavior: omitted when it IS 0)", () => {
    const { spawnPointsSet, ...withoutSpawnPointsSet } = encounter;
    const card = getPvpOpponentCard(withoutSpawnPointsSet as typeof encounter);
    expect(card.spawnPointsSet).toBe(0);
  });
});

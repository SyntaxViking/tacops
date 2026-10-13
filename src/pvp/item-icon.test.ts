import { describe, expect, it } from "vitest";
import { itemFrameUrl, itemIconUrl } from "./item-icon";

describe("itemIconUrl", () => {
  it("resolves a known item id", () => {
    expect(itemIconUrl("I_Block_C002")).not.toBeNull();
  });

  it("returns null (not throw) for an item id with no icon sprite", () => {
    // Confirmed gap from the datamine_tacticus export's own run notes: the base I_Defensive_*/
    // I_Block_* types have no icon sprite.
    expect(itemIconUrl("I_Defensive")).toBeNull();
  });

  it("falls back to a case-insensitive match when the config id and sprite filename disagree on casing", () => {
    // Real mismatch: character-power-items.json has "R_Crit_Dw02AdvancedBurstCannon" (Re'vas's
    // relic), but the sprite file is "...DW02...". Confirmed not an isolated one-off -
    // R_Block_DaemonfleshPlate/DaemonFleshPlate has the same casing split.
    expect(itemIconUrl("R_Crit_Dw02AdvancedBurstCannon")).not.toBeNull();
    expect(itemIconUrl("R_Block_DaemonfleshPlate")).not.toBeNull();
  });
});

describe("itemFrameUrl", () => {
  it("resolves every rarity tier plus relic", () => {
    for (const tier of ["common", "uncommon", "rare", "epic", "legendary", "mythic", "relic"]) {
      expect(itemFrameUrl(tier)).toContain(`ui_frame_items_${tier}.png`);
    }
  });

  it("throws on an unknown tier", () => {
    expect(() => itemFrameUrl("not_a_tier")).toThrow();
  });
});

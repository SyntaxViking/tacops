import { describe, expect, it } from "vitest";
import { upgradeIconLayers } from "./upgrade-icon";
import { Rarity } from "../rarity/rarity.enum";

describe("upgradeIconLayers", () => {
  it("resolves the shared background, the item's own icon, and the rarity-specific frame", () => {
    const layers = upgradeIconLayers("upgHpM004", Rarity.Mythic);
    expect(layers.background).toContain("ui_underlay_upgrades.png");
    expect(layers.icon).toContain("ui_icon_upgrade_upgHpM004.png");
    expect(layers.frame).toContain("ui_frame_upgrades_mythic.png");
  });

  it("picks a different frame per rarity for the same background", () => {
    const common = upgradeIconLayers("upgArmC002", Rarity.Common);
    const legendary = upgradeIconLayers("upgArmC002", Rarity.Legendary);
    expect(common.frame).toContain("ui_frame_upgrades_common.png");
    expect(legendary.frame).toContain("ui_frame_upgrades_legendary.png");
    expect(common.background).toBe(legendary.background);
  });
});

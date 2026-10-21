import { Rarity } from "../rarity/rarity.enum";

// Mirrors build_gallery.py's reward_html() upgrade branch exactly - a 3-layer composite (ui_underlay_upgrades
// as the background, the item's own icon, then the rarity-specific frame on top), pulled from the same
// extracted_assets dump the raidman-replay-gallery pipeline uses. Only the sprites actually needed by a
// bundled quest's own upgrade rewards are copied in (not the whole sprites directory) - see
// src/assets/quests/upgrade-sprites/.
const UPGRADE_RARITY_FRAME: Record<Rarity, string> = {
  [Rarity.Common]: "ui_frame_upgrades_common.png",
  [Rarity.Uncommon]: "ui_frame_upgrades_uncommon.png",
  [Rarity.Rare]: "ui_frame_upgrades_rare.png",
  [Rarity.Epic]: "ui_frame_upgrades_epic.png",
  [Rarity.Legendary]: "ui_frame_upgrades_legendary.png",
  [Rarity.Mythic]: "ui_frame_upgrades_mythic.png",
};

function upgradeSpriteUrl(file: string): string {
  return new URL(`../assets/quests/upgrade-sprites/${file}`, import.meta.url).href;
}

export interface UpgradeIconLayers {
  background: string;
  icon: string;
  frame: string;
}

// `item` is the chanceOf's item id with the %odds stripped, e.g. "upgHpM004" - resolves to
// ui_icon_upgrade_<item>.png, same naming the pipeline already uses.
export function upgradeIconLayers(item: string, rarity: Rarity): UpgradeIconLayers {
  return {
    background: upgradeSpriteUrl("ui_underlay_upgrades.png"),
    icon: upgradeSpriteUrl(`ui_icon_upgrade_${item}.png`),
    frame: upgradeSpriteUrl(UPGRADE_RARITY_FRAME[rarity]),
  };
}

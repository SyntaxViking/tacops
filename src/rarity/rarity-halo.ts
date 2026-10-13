import { Rarity } from "./rarity.enum";

// Same three-stacked-drop-shadow bloom technique as Icon.tsx's required/optional halo (small blur
// radii, calibrated for a compact icon rather than a faint 1-2px edge), just a different color per
// rarity tier instead of required/optional - per the user's request, these echo each tier's
// familiar metal/gem association (bronze/silver/gold/...), not the rarity badge icons' own colors.
const RARITY_HALO_COLOR: Record<Rarity, string> = {
  [Rarity.Common]: "139,69,19", // dominant brown (saddlebrown)
  [Rarity.Uncommon]: "205,127,50", // bronze
  [Rarity.Rare]: "192,192,192", // silver
  [Rarity.Epic]: "212,175,55", // gold
  [Rarity.Legendary]: "70,130,180", // darker blue (steelblue) - the original lightblue was too bright
  [Rarity.Mythic]: "255,140,0", // orange
};

export function rarityHaloFilter(rarity: Rarity): string {
  const rgb = RARITY_HALO_COLOR[rarity];
  return `drop-shadow(0 0 3px rgba(${rgb},1)) drop-shadow(0 0 6px rgba(${rgb},1)) drop-shadow(0 0 10px rgba(${rgb},0.9))`;
}

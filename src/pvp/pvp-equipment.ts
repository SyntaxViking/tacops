import characterPowerItems from "../assets/character-power-items.json";

interface PowerItemLevel {
  stats: Record<string, number>;
  mythicDustCost?: number;
  goldCost?: number;
}

interface PowerItemInfo {
  name: string;
  itemType: string;
  rarity: string;
  isRelic?: boolean;
  levels: PowerItemLevel[];
}

const itemsById = characterPowerItems as Record<string, PowerItemInfo>;

// Closed set (214 entries, the full GameConfig item-definition table, already bundled for power
// calculation - see character-power.ts) - an opponent fielding an item id missing from here would
// mean this table itself is stale, not a gap this should paper over.
export function getPowerItemInfo(itemId: string): PowerItemInfo {
  const info = itemsById[itemId];
  if (!info) {
    throw new Error(`Unknown item id: ${itemId}`);
  }
  return info;
}

// Relics keep rarity: "Mythic" in character-power-items.json (they ARE Mythic-rarity items), but
// render with the mythic frame underneath and a distinct relic frame layered on top - not a swap
// to a single "relic" tier. Everything else is a single frame. Returned lowest-to-topmost so a
// caller can just render one <img> per tier in order.
export function itemFrameTiers(rarity: string, isRelic: boolean | undefined): string[] {
  if (isRelic) return ["mythic", "relic"];
  return [rarity.toLowerCase()];
}

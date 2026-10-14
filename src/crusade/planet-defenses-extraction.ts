import type { PlanetDefenseCounts } from "../api/types";

// Planetary defenses don't appear anywhere in the dedicated GET_CRUSADE call's own mapped shape
// (CrusadePlanet) - confirmed by direct inspection of mapCrusadeResponseData, which only reads
// planetId/sideOwner/ownedByFaction/pointsFor/pointsAgainst/struggleData/zone off each raw planet.
// Same situation as the sector map layout (see sector-map-extraction.ts's own comment): it only
// shows up in GET_PLAYER's own embedded copy of the crusade live event, this time in each
// planetsData[] entry's `buffs` array rather than planetsConfig. Confirmed via a real capture: a
// contested planet can carry up to one `{type: "PlanetaryDefenses", side: "For"|"Against",
// defensePoints}` buff per side. `defensePoints` is a raw points value, not a literal count of
// defenses placed - today's defenses are each worth 105000 points, though legacy 1000-point
// defenses from before a game rebalance can still be mixed into that same total on some planets
// (confirmed with the user, who said to just floor-divide by 105000 regardless of that noise).
const POINTS_PER_DEFENSE = 105000;

// `hero` is GET_PLAYER's player.hero; anything missing yields an empty map rather than throwing.
export function extractPlanetDefenses(hero: any): Record<string, PlanetDefenseCounts> {
  const crusadeEventModule = hero?.liveEvents?.liveEvents
    ?.find((e: any) => e?.modules?.some((m: any) => m.type === "crusadeEvent"))
    ?.modules?.find((m: any) => m.type === "crusadeEvent")?.module;

  const result: Record<string, PlanetDefenseCounts> = {};
  for (const planet of crusadeEventModule?.planetsData ?? []) {
    const buffs = (planet?.buffs ?? []).filter((b: any) => b?.type === "PlanetaryDefenses");
    const imperial = buffs.find((b: any) => b.side === "For")?.defensePoints ?? 0;
    const devastation = buffs.find((b: any) => b.side === "Against")?.defensePoints ?? 0;
    if (imperial > 0 || devastation > 0) {
      result[planet.planetId] = {
        imperial: Math.floor(imperial / POINTS_PER_DEFENSE),
        devastation: Math.floor(devastation / POINTS_PER_DEFENSE),
      };
    }
  }
  return result;
}

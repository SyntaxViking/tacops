import type { CrusadeSectorMap } from "../api/types";

// The map layout (positions/adjacency) isn't in the dedicated GET_CRUSADE call
// (fetch-crusade-data.ts) - confirmed via a real capture it's simply absent there. It only shows
// up in GET_PLAYER's own embedded copy of the crusade live event. `hero` is GET_PLAYER's
// player.hero; anything missing yields an empty map rather than throwing.
export function extractSectorMap(hero: any): CrusadeSectorMap {
  const crusadeEventModule = hero?.liveEvents?.liveEvents
    ?.find((e: any) => e?.modules?.some((m: any) => m.type === "crusadeEvent"))
    ?.modules?.find((m: any) => m.type === "crusadeEvent")?.module;
  return {
    planets: (crusadeEventModule?.planetsConfig?.planets ?? [])
      .filter((p: any) => p.type !== "Sun")
      .map((p: any) => ({
        planetId: p.planetId,
        zone: parseInt(p.zone.replace("zone", ""), 10) - 1,
        type: p.type,
        positionX: p.positionX ?? 0,
        positionY: p.positionY ?? 0,
      })),
    connections: (crusadeEventModule?.planetsConfig?.connections ?? []).map((c: any) => ({
      planet1: c.planet1,
      planet2: c.planet2,
    })),
  };
}

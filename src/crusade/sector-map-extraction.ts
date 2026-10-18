import type { CrusadeSectorMap } from "../api/types";

// The map layout (positions/adjacency) isn't in the dedicated GET_CRUSADE call
// (fetch-crusade-data.ts) - confirmed via a real capture it's simply absent there. It only shows
// up in GET_PLAYER's own embedded copy of the crusade live event. `hero` is GET_PLAYER's
// player.hero; anything missing yields an empty map rather than throwing.
//
// More than one crusadeEvent liveEvent can be present simultaneously - confirmed 2026-10-18, where
// the outgoing crusade's own liveEvent (startsOn 2026-07-22, endsOn 2026-10-18T00:00:00Z) and the
// next one's (startsOn 2026-10-18T00:00:00Z) briefly coexisted in a real GET_PLAYER response.
// Picking "whichever happens to come first in the array" (the old behavior) is order-dependent and
// can silently pick the wrong one - pick the one whose own startsOn/endsOn actually brackets now
// instead, same resolution strategy as worker/poller.ts's findActivePhase. Falls back to the first
// crusadeEvent found if none brackets now (shouldn't normally happen, but better than returning an
// empty map on an edge case).
export function activeCrusadeEventLiveEvent(liveEvents: any[]): any {
  const nowMs = Date.now();
  const crusadeEventLiveEvents = liveEvents.filter((e) => e?.modules?.some((m: any) => m.type === "crusadeEvent"));
  return crusadeEventLiveEvents.find((e) => e.startsOn <= nowMs && nowMs < e.endsOn) ?? crusadeEventLiveEvents[0];
}

export function extractSectorMap(hero: any): CrusadeSectorMap {
  const crusadeEventModule = activeCrusadeEventLiveEvent(hero?.liveEvents?.liveEvents ?? [])?.modules?.find((m: any) => m.type === "crusadeEvent")?.module;
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

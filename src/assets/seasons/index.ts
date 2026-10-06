// Resolves src/season.ts's SEASON_SCHEDULE (against whatever moment each caller asks about) to
// that season's bundled planet layout - the one place that actually imports every season's JSON
// files, so every other reader (worker/poller.ts, src/api/fetch-crusade-data.ts,
// src/components/AnonymousCrusadeSection.tsx) just calls getPlanetData()/getSectorMapData() and
// never has to know seasons exist at all.
//
// Adding a new season is exactly three steps, and TypeScript enforces the second one: add its
// version to src/season.ts's Season type/SEASONS array, add its two JSON files' imports and map
// entries below (missing one is a type error - the maps are typed Record<Season, ...>), and add it
// to SEASON_SCHEDULE with endsAt: null (see README's "Crusade seasons" section).
//
// getPlanetData/getSectorMapData resolve fresh on every call rather than being cached module-level
// constants - the active season can change at any moment SEASON_SCHEDULE's endsAt passes,
// independent of any deploy, so a result computed once and hoisted to a constant would freeze at
// whatever moment this module happened to first load. Callers should call these at the point they
// need the data (every time), not hoist the result themselves for the same reason.
import { activeSeason, type Season } from "../../season";
import planetData_1_41 from "./1.41/planet-data.json";
import sectorMap_1_41 from "./1.41/sector-map.json";
import planetData_1_43 from "./1.43/planet-data.json";
import sectorMap_1_43 from "./1.43/sector-map.json";

const PLANET_DATA_BY_SEASON: Record<Season, unknown> = {
  "1.41": planetData_1_41,
  "1.43": planetData_1_43,
};

const SECTOR_MAP_BY_SEASON: Record<Season, unknown> = {
  "1.41": sectorMap_1_41,
  "1.43": sectorMap_1_43,
};

export function getPlanetData(nowMs: number = Date.now()): unknown {
  return PLANET_DATA_BY_SEASON[activeSeason(nowMs)];
}

export function getSectorMapData(nowMs: number = Date.now()): unknown {
  return SECTOR_MAP_BY_SEASON[activeSeason(nowMs)];
}

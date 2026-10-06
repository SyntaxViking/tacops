import { describe, expect, it } from "vitest";
import { getPlanetData, getSectorMapData } from "./index";
import planetData_1_41 from "./1.41/planet-data.json";
import sectorMap_1_41 from "./1.41/sector-map.json";
import planetData_1_43 from "./1.43/planet-data.json";
import sectorMap_1_43 from "./1.43/sector-map.json";

// src/season.ts's SEASON_SCHEDULE has season 1.41 ending 2026-10-19T00:00:00Z, then 1.43 ongoing.
// This just guards against a typo'd map entry (the Record<Season, ...> typing in ./index.ts
// already guards against a missing one) and a schedule/map mismatch at the boundary itself -
// resolveActiveSeason's own logic has its own thorough tests in src/season.test.ts.
const SEASON_1_41_ENDS_AT = new Date("2026-10-19T00:00:00Z").getTime();

describe("getPlanetData/getSectorMapData", () => {
  it("resolve to season 1.41's own files before its endsAt", () => {
    expect(getPlanetData(0)).toEqual(planetData_1_41);
    expect(getPlanetData(SEASON_1_41_ENDS_AT - 1)).toEqual(planetData_1_41);
    expect(getSectorMapData(0)).toEqual(sectorMap_1_41);
    expect(getSectorMapData(SEASON_1_41_ENDS_AT - 1)).toEqual(sectorMap_1_41);
  });

  it("resolve to season 1.43's own files from its endsAt onward", () => {
    expect(getPlanetData(SEASON_1_41_ENDS_AT)).toEqual(planetData_1_43);
    expect(getSectorMapData(SEASON_1_41_ENDS_AT)).toEqual(sectorMap_1_43);
  });
});

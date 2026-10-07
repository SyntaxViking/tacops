// Rebuilds src/assets/seasons/<season>/sector-map.json - the crusade sector map layout bundled for
// the logged-out home page, which has no GET_PLAYER (the only place the layout appears) to read it
// from. Run it against a full GET_PLAYER response, i.e. the "Export JSON" file from a logged-in
// session:
//
//   npx vite-node scripts/extract-sector-map.ts <season> "<path-to-tacops-prod-player-data.json>"
//
// <season> is one of src/season.ts's SEASONS (e.g. "1.41") - always explicit, never defaulted to
// CURRENT_SEASON, since regenerating this is just as often done to prepare an upcoming season (see
// README's "Preparing a new crusade season") as to refresh the live one, and getting that backwards
// would silently overwrite the wrong one.
import { readFileSync, writeFileSync } from "node:fs";
import { extractSectorMap } from "../src/crusade/sector-map-extraction";
import { SEASONS } from "../src/season";

const season = process.argv[2];
const exportPath = process.argv[3];
if (!season || !exportPath) {
  console.error(`usage: extract-sector-map.ts <season> <player-data-export.json>\nknown seasons: ${SEASONS.join(", ")}`);
  process.exit(1);
}
if (!(SEASONS as readonly string[]).includes(season)) {
  console.error(`unknown season "${season}" - known seasons: ${SEASONS.join(", ")}`);
  process.exit(1);
}

const response = JSON.parse(readFileSync(exportPath, "utf8"));
const sectorMap = extractSectorMap(response?.eventResult?.eventResponseData?.player?.hero);
if (sectorMap.planets.length === 0) {
  console.error("No crusade sector map found in that export - is it a full GET_PLAYER response?");
  process.exit(1);
}

const outPath = new URL(`../src/assets/seasons/${season}/sector-map.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(sectorMap, null, 1) + "\n");
console.log(`Wrote ${sectorMap.planets.length} planets and ${sectorMap.connections.length} connections to ${outPath.pathname}`);

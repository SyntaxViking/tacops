// Rebuilds src/assets/sector-map.json - the crusade sector map layout bundled for the logged-out
// home page, which has no GET_PLAYER (the only place the layout appears) to read it from. Run it
// against a full GET_PLAYER response, i.e. the "Export JSON" file from a logged-in session:
//
//   npx vite-node scripts/extract-sector-map.ts "<path-to-tacops-prod-player-data.json>"
import { readFileSync, writeFileSync } from "node:fs";
import { extractSectorMap } from "../src/crusade/sector-map-extraction";

const exportPath = process.argv[2];
if (!exportPath) {
  console.error("usage: extract-sector-map.ts <player-data-export.json>");
  process.exit(1);
}

const response = JSON.parse(readFileSync(exportPath, "utf8"));
const sectorMap = extractSectorMap(response?.eventResult?.eventResponseData?.player?.hero);
if (sectorMap.planets.length === 0) {
  console.error("No crusade sector map found in that export - is it a full GET_PLAYER response?");
  process.exit(1);
}

const outPath = new URL("../src/assets/sector-map.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(sectorMap, null, 1) + "\n");
console.log(`Wrote ${sectorMap.planets.length} planets and ${sectorMap.connections.length} connections to ${outPath.pathname}`);

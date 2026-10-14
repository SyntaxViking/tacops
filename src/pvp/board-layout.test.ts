import { describe, expect, it } from "vitest";
import { resolveCharacterSpawnPositions, type SpawnPointManifest } from "./board-layout";

// A real slice of board-assets/spawn-points.json (board C1_02, spawnPointsSetIndex 3) - team 0 is
// the player's own deploy side, team 1 is the opponent's.
const manifest: SpawnPointManifest = {
  C1_02: [
    {
      spawnPointsSetIndex: 3,
      groups: [
        {
          teamWithPlayerIndex: 0,
          machineOfWarPosition: 2,
          spawnPoints: [
            { index: 0, x: 35.45, y: 309.39, column: 0, row: 0, spawnPointType: 0, tag: "", direction: 0, room: -1 },
          ],
        },
        {
          teamWithPlayerIndex: 1,
          machineOfWarPosition: 1,
          spawnPoints: [
            { index: 0, x: 208.52, y: 30.09, column: 4, row: 6, spawnPointType: 0, tag: "", direction: 3, room: -1 },
            { index: 1, x: 165.25, y: 52.91, column: 3, row: 6, spawnPointType: 0, tag: "", direction: 3, room: -1 },
            { index: 2, x: 121.98, y: 30.09, column: 2, row: 6, spawnPointType: 0, tag: "", direction: 3, room: -1 },
            { index: 3, x: 208.52, y: 81.23, column: 4, row: 5, spawnPointType: 0, tag: "", direction: 3, room: -1 },
            { index: 4, x: 78.71, y: 58.42, column: 1, row: 6, spawnPointType: 0, tag: "", direction: 3, room: -1 },
          ],
        },
      ],
    },
  ],
};

const lineup = ["ultraTigurius", "ultraEliminatorSgt", "ultraInceptorSgt", "ultraApothecary", "ultraCalgar"];

describe("resolveCharacterSpawnPositions", () => {
  it("picks the opponent's (teamWithPlayerIndex 1) group for the requested spawnPointsSet, pairing lineup order to spawn point order", () => {
    const positions = resolveCharacterSpawnPositions(manifest, "C1_02", 3, lineup);
    expect(positions).toEqual([
      { characterId: "ultraTigurius", x: 208.52, y: 30.09 },
      { characterId: "ultraEliminatorSgt", x: 165.25, y: 52.91 },
      { characterId: "ultraInceptorSgt", x: 121.98, y: 30.09 },
      { characterId: "ultraApothecary", x: 208.52, y: 81.23 },
      { characterId: "ultraCalgar", x: 78.71, y: 58.42 },
    ]);
  });

  it("returns an empty array for an unknown board id", () => {
    expect(resolveCharacterSpawnPositions(manifest, "NOT_A_BOARD", 3, lineup)).toEqual([]);
  });

  it("returns an empty array for a spawnPointsSet index the board doesn't have", () => {
    expect(resolveCharacterSpawnPositions(manifest, "C1_02", 99, lineup)).toEqual([]);
  });

  it("caps at however many spawn points the group actually has, rather than throwing on a mismatch", () => {
    const positions = resolveCharacterSpawnPositions(manifest, "C1_02", 3, [...lineup, "ultraTitus"]);
    expect(positions).toHaveLength(5);
  });
});

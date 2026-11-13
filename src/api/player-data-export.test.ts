import { describe, expect, it } from "vitest";
import { buildPlayerDataExport, SOLVER_SETTINGS_KEY } from "./player-data-export";

const settings = {
  priorityOrder: ["rarity", "intel", "crusadeBomb", "crusadeNpc"] as const,
  favoritedCharacterIds: new Set(["worldKharn", "custoKyrus"]),
  antiFavoritedCharacterIds: new Set(["deathRotbone"]),
  favoritedPlanetIds: new Set(["p2", "p1"]),
};
const now = new Date("2026-11-12T20:00:00.000Z");

describe("buildPlayerDataExport", () => {
  it("adds the solver settings under their own key and keeps the game data untouched", () => {
    const raw = { eventResult: { eventResponseData: { player: { hero: { units: {} } } } } };

    const exported = buildPlayerDataExport(raw, settings, now) as Record<string, unknown>;

    expect(exported.eventResult).toEqual(raw.eventResult);
    expect(exported[SOLVER_SETTINGS_KEY]).toEqual({
      priorityOrder: ["rarity", "intel", "crusadeBomb", "crusadeNpc"],
      favoritedCharacterIds: ["custoKyrus", "worldKharn"],
      antiFavoritedCharacterIds: ["deathRotbone"],
      favoritedPlanetIds: ["p1", "p2"],
      exportedAt: "2026-11-12T20:00:00.000Z",
    });
  });

  it("does not mutate the raw player data it was given", () => {
    const raw = { a: 1 };

    buildPlayerDataExport(raw, settings, now);

    expect(raw).toEqual({ a: 1 });
  });

  it("returns non-object data as is, since there's nothing to attach settings to", () => {
    expect(buildPlayerDataExport(null, settings, now)).toBeNull();
    expect(buildPlayerDataExport([1, 2], settings, now)).toEqual([1, 2]);
  });
});

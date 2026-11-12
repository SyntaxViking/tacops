import type { PriorityKey } from "../board/reward-amount";

// The user's own TacOps settings that change what the board solver does - none of them are part of
// the game's player data, so a bug-report export without them can't reproduce the exact solve the
// user saw. Stored under its own top-level key (never merged into the game data's own structure) so
// it can't collide with anything the game sends, and anything that reads the export as raw player
// data (e.g. calculateBundledUnitPowers) simply ignores it.
export const SOLVER_SETTINGS_KEY = "tacopsSolverSettings";

export interface SolverSettingsExport {
  priorityOrder: PriorityKey[];
  favoritedCharacterIds: string[];
  antiFavoritedCharacterIds: string[];
  favoritedPlanetIds: string[];
  exportedAt: string;
}

export function buildPlayerDataExport(
  rawPlayerData: unknown,
  settings: {
    priorityOrder: readonly PriorityKey[];
    favoritedCharacterIds: ReadonlySet<string>;
    antiFavoritedCharacterIds: ReadonlySet<string>;
    favoritedPlanetIds: ReadonlySet<string>;
  },
  now: Date = new Date(),
): unknown {
  // Not a plain object (null before the first fetch, or something unexpected) - nothing to attach
  // the settings to, so export it untouched rather than inventing a wrapper that changes its shape.
  if (typeof rawPlayerData !== "object" || rawPlayerData === null || Array.isArray(rawPlayerData)) {
    return rawPlayerData;
  }
  const exported: SolverSettingsExport = {
    priorityOrder: [...settings.priorityOrder],
    favoritedCharacterIds: [...settings.favoritedCharacterIds].sort(),
    antiFavoritedCharacterIds: [...settings.antiFavoritedCharacterIds].sort(),
    favoritedPlanetIds: [...settings.favoritedPlanetIds].sort(),
    exportedAt: now.toISOString(),
  };
  return { ...rawPlayerData, [SOLVER_SETTINGS_KEY]: exported };
}

import { describe, expect, it } from "vitest";
import { entryFinishAt, entryIsUnavailable, entryStatusLabel, getDispatchedUnits } from "./board-view-model";
import type { ExpeditionBoardEntry } from "../api/types";

function entry(status: string, overrides: Partial<ExpeditionBoardEntry> = {}): ExpeditionBoardEntry {
  return {
    expeditionId: "e1",
    id: "op1",
    category: "combat",
    rarity: "Common",
    participants: 1,
    duration: 60,
    bonusObjectives: [],
    baseRewards: [],
    bonusRewards: [],
    status,
    ...overrides,
  };
}

// Regression coverage for a "stuck on Solving" bug: if the live API ever sends a status string
// that differs in case from the exact literals "Dispatched"/"Completed", these functions used to
// silently treat the entry as available - keeping it in the solver's input and (worse) letting
// the app-level fast path miss it too, so the LP solver would run for real (up to ~70s) instead
// of skipping immediately.
describe("entryIsUnavailable", () => {
  it("matches the exact-case literals", () => {
    expect(entryIsUnavailable(entry("Dispatched"))).toBe(true);
    expect(entryIsUnavailable(entry("Completed"))).toBe(true);
  });

  it("matches regardless of case", () => {
    expect(entryIsUnavailable(entry("dispatched"))).toBe(true);
    expect(entryIsUnavailable(entry("DISPATCHED"))).toBe(true);
    expect(entryIsUnavailable(entry("completed"))).toBe(true);
  });

  it("is false for a ready/available entry", () => {
    expect(entryIsUnavailable(entry("Available"))).toBe(false);
  });
});

describe("entryStatusLabel", () => {
  it("labels case-insensitively", () => {
    expect(entryStatusLabel(entry("dispatched"))).toBe("Dispatched");
    expect(entryStatusLabel(entry("COMPLETED"))).toBe("Complete");
    expect(entryStatusLabel(entry("Available"))).toBe("Ready");
  });
});

describe("entryFinishAt", () => {
  it("computes a finish time for a dispatched entry regardless of case", () => {
    const e = entry("DISPATCHED", { startedOn: 1000, duration: 60 });
    expect(entryFinishAt(e)).toBe(1000 + 60 * 1000);
  });

  it("returns null for a non-dispatched entry", () => {
    expect(entryFinishAt(entry("Available", { startedOn: 1000 }))).toBeNull();
  });
});

describe("getDispatchedUnits", () => {
  // Regression: a character id can be recognized (in character-data.json) before its portrait
  // asset lands in character-portraits.ts - e.g. orksWeirdboy (Zapspitta) right after it was added
  // to the catalog. That used to crash the whole board view via characterPortraitUrl's throw;
  // it should fall back to no portrait instead, same as an unrecognized id.
  it("falls back to no portrait for a recognized character id with no mapped portrait", () => {
    const dispatched = entry("Dispatched", { units: ["orksWeirdboy"] });

    expect(() => getDispatchedUnits(dispatched)).not.toThrow();
    expect(getDispatchedUnits(dispatched)).toEqual([{ unitId: "orksWeirdboy", portraitUrl: undefined }]);
  });
});

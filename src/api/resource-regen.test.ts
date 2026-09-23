import { describe, expect, it } from "vitest";
import {
  computeGuildBossTimings,
  computePvpTimings,
  computeStaminaTimings,
  computeSurvivalTimings,
  computeWavesTimings,
} from "./resource-regen";

describe("computeStaminaTimings", () => {
  it("computes next/cap using the power-level-indexed cap", () => {
    // powerLevel 68 -> maxStamina 154 (verified against a real account)
    const result = computeStaminaTimings({ currentAmount: 58, lastUpdatedThreshold: 1_000_000 }, 68);

    expect(result.nextTokenAt).toBe(1_000_000 + 300_000);
    expect(result.capAt).toBe(1_000_000 + 300_000 * (154 - 58));
  });

  it("returns nulls when already at or above the level's cap", () => {
    const result = computeStaminaTimings({ currentAmount: 60, lastUpdatedThreshold: 1_000_000 }, 0);

    expect(result).toEqual({ nextTokenAt: null, capAt: null });
  });

  it("clamps an out-of-range power level to the last table entry instead of throwing", () => {
    const result = computeStaminaTimings({ currentAmount: 100, lastUpdatedThreshold: 1_000_000 }, 9999);

    // last table entry is 185
    expect(result.capAt).toBe(1_000_000 + 300_000 * (185 - 100));
  });

  it("returns nulls when the stamina object is missing entirely", () => {
    expect(computeStaminaTimings(undefined, 68)).toEqual({ nextTokenAt: null, capAt: null });
  });
});

describe("computeSurvivalTimings", () => {
  it("computes next/cap from the live event's own maxStamina/regen config", () => {
    // Real values from a live capture: staminaRegenerationTime is in seconds (43201 -> ~12h).
    const result = computeSurvivalTimings({ lastUpdatedThreshold: 1_000_000 }, 5, 43_201_000);

    expect(result.nextTokenAt).toBe(1_000_000 + 43_201_000);
    expect(result.capAt).toBe(1_000_000 + 43_201_000 * 5);
  });

  it("returns nulls when no seasonal event is live (config undefined)", () => {
    const result = computeSurvivalTimings({ lastUpdatedThreshold: 1_000_000 }, undefined, undefined);

    expect(result).toEqual({ nextTokenAt: null, capAt: null });
  });
});

describe("computeWavesTimings", () => {
  it("computes next/cap against the flat waves cap of 3", () => {
    const result = computeWavesTimings({ currentAmount: 1, lastUpdatedThreshold: 1_000_000 });

    expect(result.nextTokenAt).toBe(1_000_000 + 57_600_000);
    expect(result.capAt).toBe(1_000_000 + 57_600_000 * 2);
  });
});

describe("computeGuildBossTimings", () => {
  it("finds the same-day burn checkpoint when already at cap and it's still before 09:45 UTC", () => {
    const now = Date.UTC(2026, 0, 1, 8, 0, 0); // 08:00 UTC Jan 1

    const result = computeGuildBossTimings({ currentAmount: 3, lastUpdatedThreshold: now }, now);

    expect(result.nextTokenAt).toBeNull();
    expect(result.capAt).toBeNull();
    expect(result.burnAt).toBe(Date.UTC(2026, 0, 1, 9, 45, 0));
  });

  it("finds the burn checkpoint after the projected cap time, not after 'now'", () => {
    // currentAmount 2, missing 1 -> capAt = lastUpdated + 12h = 21:00 UTC Jan 1
    const lastUpdated = Date.UTC(2026, 0, 1, 9, 0, 0);
    const now = lastUpdated; // far before capAt

    const result = computeGuildBossTimings({ currentAmount: 2, lastUpdatedThreshold: lastUpdated }, now);

    expect(result.capAt).toBe(Date.UTC(2026, 0, 1, 21, 0, 0));
    expect(result.burnAt).toBe(Date.UTC(2026, 0, 1, 22, 45, 0)); // next checkpoint after 21:00 UTC Jan 1
  });

  it("picks the 09:45 UTC checkpoint when the cap time falls between 22:45 and the next day's 09:45", () => {
    // currentAmount 1, missing 2 -> capAt = lastUpdated + 24h = 09:00 UTC Jan 2
    const lastUpdated = Date.UTC(2026, 0, 1, 9, 0, 0);

    const result = computeGuildBossTimings({ currentAmount: 1, lastUpdatedThreshold: lastUpdated }, lastUpdated);

    expect(result.capAt).toBe(Date.UTC(2026, 0, 2, 9, 0, 0));
    expect(result.burnAt).toBe(Date.UTC(2026, 0, 2, 9, 45, 0));
  });

  it("rolls over to the next day's 09:45 UTC checkpoint when the cap time is after 22:45", () => {
    // currentAmount 2, missing 1, lastUpdated chosen so capAt lands at 23:30 UTC Jan 1
    const lastUpdated = Date.UTC(2026, 0, 1, 11, 30, 0);

    const result = computeGuildBossTimings({ currentAmount: 2, lastUpdatedThreshold: lastUpdated }, lastUpdated);

    expect(result.capAt).toBe(Date.UTC(2026, 0, 1, 23, 30, 0));
    expect(result.burnAt).toBe(Date.UTC(2026, 0, 2, 9, 45, 0));
  });
});

describe("computePvpTimings", () => {
  const LAST_UPDATED = 1_000_000;
  const NOW = 1_500_000; // before LAST_UPDATED + one full regen cycle either way

  it("shows normal next/cap when the cap would be reached before the season stop", () => {
    // currentAmount 14, missing 1 -> capAt = LAST_UPDATED + 9_600_000, well before a distant deadline
    const staminaRegenUntil = LAST_UPDATED + 100_000_000;

    const result = computePvpTimings({ currentAmount: 14, lastUpdatedThreshold: LAST_UPDATED }, staminaRegenUntil, NOW);

    expect(result).toEqual({
      nextTokenAt: LAST_UPDATED + 9_600_000,
      capAt: LAST_UPDATED + 9_600_000,
      pausesAt: null,
      stopped: false,
    });
  });

  it("shows the pause boundary instead of a full time when the cap wouldn't be reached before the stop", () => {
    // currentAmount 2, missing 13 -> naive capAt is far in the future; deadline arrives first
    const staminaRegenUntil = LAST_UPDATED + 9_600_000 + 500_000; // just after the first tick

    const result = computePvpTimings({ currentAmount: 2, lastUpdatedThreshold: LAST_UPDATED }, staminaRegenUntil, NOW);

    expect(result.nextTokenAt).toBe(LAST_UPDATED + 9_600_000); // still before the deadline
    expect(result.capAt).toBeNull();
    expect(result.pausesAt).toBe(staminaRegenUntil);
    expect(result.stopped).toBe(false);
  });

  it("omits even the next-token time once the deadline has already passed that tick", () => {
    const staminaRegenUntil = LAST_UPDATED + 100; // deadline arrives before the next tick would

    const result = computePvpTimings({ currentAmount: 2, lastUpdatedThreshold: LAST_UPDATED }, staminaRegenUntil, LAST_UPDATED + 50);

    expect(result.nextTokenAt).toBeNull();
    expect(result.pausesAt).toBe(staminaRegenUntil);
  });

  it("reports stopped with no schedule once now is past the season deadline", () => {
    const staminaRegenUntil = LAST_UPDATED + 1_000;

    const result = computePvpTimings(
      { currentAmount: 2, lastUpdatedThreshold: LAST_UPDATED },
      staminaRegenUntil,
      staminaRegenUntil + 1,
    );

    expect(result).toEqual({ nextTokenAt: null, capAt: null, pausesAt: null, stopped: true });
  });

  it("returns nulls when already at cap, regardless of the deadline", () => {
    const result = computePvpTimings({ currentAmount: 15, lastUpdatedThreshold: LAST_UPDATED }, LAST_UPDATED - 1, NOW);

    expect(result).toEqual({ nextTokenAt: null, capAt: null, pausesAt: null, stopped: false });
  });

  it("falls back to normal next/cap math when no deadline is known at all", () => {
    const result = computePvpTimings({ currentAmount: 14, lastUpdatedThreshold: LAST_UPDATED }, null, NOW);

    expect(result).toEqual({
      nextTokenAt: LAST_UPDATED + 9_600_000,
      capAt: LAST_UPDATED + 9_600_000,
      pausesAt: null,
      stopped: false,
    });
  });
});

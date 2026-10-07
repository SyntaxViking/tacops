import { describe, expect, it } from "vitest";
import {
  computeGuildBossTimings,
  computePvpTimings,
  computeStaminaTimings,
  computeSurvivalTimings,
  computeWavesTimings,
  PVP_BURN_CHECKPOINT_UTC_MINUTES,
} from "./resource-regen";

// 9 checkpoints, one every 2h40m (the arena regen interval) starting from the 03:20 CEST anchor
// (arena's own daily regen-cycle end time) - confirmed directly by the user, replacing first an
// earlier guess at only 3 checkpoints 8h apart, then a second guess that got the anchor itself 40
// minutes late (04:00 CEST instead of the real 03:20 CEST).
describe("PVP_BURN_CHECKPOINT_UTC_MINUTES", () => {
  it("matches the user's own 9 confirmed CEST checkpoints exactly (CEST = UTC+2)", () => {
    const cest = PVP_BURN_CHECKPOINT_UTC_MINUTES.map((m) => {
      const shifted = (m + 120) % (24 * 60);
      return `${String(Math.floor(shifted / 60)).padStart(2, "0")}${String(shifted % 60).padStart(2, "0")}`;
    });
    expect(cest.sort()).toEqual(["0040", "0320", "0600", "0840", "1120", "1400", "1640", "1920", "2200"]);
  });
});

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
      // capAt (10,600,000 = 02:56:40 UTC Jan 1 1970) falls between the 01:20 and 04:00 UTC
      // checkpoints (every 2h40m from the 01:20 UTC/03:20 CEST anchor), so the next one is 04:00 UTC.
      burnAt: Date.UTC(1970, 0, 1, 4, 0, 0),
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
    // Under cap with no projected cap time (regen pauses first) - no burn risk to project.
    expect(result.burnAt).toBeNull();
  });

  it("omits even the next-token time once the deadline has already passed that tick", () => {
    const staminaRegenUntil = LAST_UPDATED + 100; // deadline arrives before the next tick would

    const result = computePvpTimings({ currentAmount: 2, lastUpdatedThreshold: LAST_UPDATED }, staminaRegenUntil, LAST_UPDATED + 50);

    expect(result.nextTokenAt).toBeNull();
    expect(result.pausesAt).toBe(staminaRegenUntil);
    expect(result.burnAt).toBeNull();
  });

  it("reports stopped with no schedule once now is past the season deadline", () => {
    const staminaRegenUntil = LAST_UPDATED + 1_000;

    const result = computePvpTimings(
      { currentAmount: 2, lastUpdatedThreshold: LAST_UPDATED },
      staminaRegenUntil,
      staminaRegenUntil + 1,
    );

    expect(result).toEqual({ nextTokenAt: null, capAt: null, pausesAt: null, stopped: true, burnAt: null });
  });

  it("finds the next burn checkpoint from 'now' when already at cap, regardless of the deadline", () => {
    const result = computePvpTimings({ currentAmount: 15, lastUpdatedThreshold: LAST_UPDATED }, LAST_UPDATED - 1, NOW);

    expect(result).toEqual({
      nextTokenAt: null,
      capAt: null,
      pausesAt: null,
      stopped: false,
      // NOW (1,500,000 = 00:25:00 UTC Jan 1 1970) is before the first checkpoint of the day.
      burnAt: Date.UTC(1970, 0, 1, 1, 20, 0),
    });
  });

  it("falls back to normal next/cap math when no deadline is known at all", () => {
    const result = computePvpTimings({ currentAmount: 14, lastUpdatedThreshold: LAST_UPDATED }, null, NOW);

    expect(result).toEqual({
      nextTokenAt: LAST_UPDATED + 9_600_000,
      capAt: LAST_UPDATED + 9_600_000,
      pausesAt: null,
      stopped: false,
      burnAt: Date.UTC(1970, 0, 1, 4, 0, 0),
    });
  });

  it("finds the next day's burn checkpoint when the projected cap time falls between the last checkpoint of one day and the first of the next", () => {
    // currentAmount 14, missing 1 -> capAt lands at 00:00 UTC Jan 2, between Jan 1's last
    // checkpoint (22:40) and Jan 2's first (01:20).
    const lastUpdated = Date.UTC(2026, 0, 2, 0, 0, 0) - 9_600_000;
    const result = computePvpTimings({ currentAmount: 14, lastUpdatedThreshold: lastUpdated }, null, lastUpdated);

    expect(result.capAt).toBe(Date.UTC(2026, 0, 2, 0, 0, 0));
    expect(result.burnAt).toBe(Date.UTC(2026, 0, 2, 1, 20, 0));
  });

  it("finds the same day's next checkpoint (every 2h40m, not just a handful a day) after 19:00 UTC", () => {
    // currentAmount 14, missing 1 -> capAt lands at 19:00 UTC Jan 1, between that day's 17:20 and
    // 20:00 checkpoints - still the same day, since checkpoints repeat every 2h40m all day long.
    const lastUpdated = Date.UTC(2026, 0, 1, 19, 0, 0) - 9_600_000;
    const result = computePvpTimings({ currentAmount: 14, lastUpdatedThreshold: lastUpdated }, null, lastUpdated);

    expect(result.capAt).toBe(Date.UTC(2026, 0, 1, 19, 0, 0));
    expect(result.burnAt).toBe(Date.UTC(2026, 0, 1, 20, 0, 0));
  });

  it("rolls over to the next day's 01:20 UTC checkpoint when the cap time is after that day's last one (22:40)", () => {
    // currentAmount 14, missing 1 -> capAt lands at 23:30 UTC Jan 1, after the day's final checkpoint.
    const lastUpdated = Date.UTC(2026, 0, 1, 23, 30, 0) - 9_600_000;
    const result = computePvpTimings({ currentAmount: 14, lastUpdatedThreshold: lastUpdated }, null, lastUpdated);

    expect(result.capAt).toBe(Date.UTC(2026, 0, 1, 23, 30, 0));
    expect(result.burnAt).toBe(Date.UTC(2026, 0, 2, 1, 20, 0));
  });
});

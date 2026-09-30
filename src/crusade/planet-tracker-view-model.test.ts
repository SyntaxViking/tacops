import { describe, expect, it } from "vitest";
import {
  appendTrackedSample,
  computeAxisScale,
  computeTrackerGraphPoints,
  createTrackedPlanetState,
  formatAxisValue,
  restartIfRecontested,
  timeAxisStepSeconds,
  type TrackedPlanetState,
} from "./planet-tracker-view-model";
import type { CrusadePlanet } from "../api/types";

function planet(overrides: Partial<CrusadePlanet> = {}): CrusadePlanet {
  return { planetId: "planet_001", name: "Test Planet", zone: null, ...overrides };
}

function liveContestedPlanet(pointsFor: number, pointsAgainst: number): CrusadePlanet {
  return planet({
    sideOwner: "For",
    pointsFor,
    pointsAgainst,
    struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
  });
}

describe("appendTrackedSample", () => {
  it("appends a sample with each side's remaining points", () => {
    const state = createTrackedPlanetState("planet_001", 1000);
    const next = appendTrackedSample(state, liveContestedPlanet(100, 200), 2000);
    expect(next.samples).toEqual([{ atMs: 2000, imperialRemaining: 900, devastationRemaining: 800 }]);
    expect(next.frozen).toBe(false);
  });

  it("is a no-op once frozen - the graph stays exactly where it was", () => {
    const frozen: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [{ atMs: 1500, imperialRemaining: 0, devastationRemaining: 500 }],
      frozen: true,
    };
    const next = appendTrackedSample(frozen, liveContestedPlanet(500, 500), 9999);
    expect(next).toBe(frozen);
  });

  it("freezes on the sample that first shows a side at exactly 0 remaining", () => {
    const state = createTrackedPlanetState("planet_001", 1000);
    const next = appendTrackedSample(state, liveContestedPlanet(1000, 400), 2000);
    expect(next.frozen).toBe(true);
    expect(next.samples).toHaveLength(1);
    expect(next.samples[0]).toEqual({ atMs: 2000, imperialRemaining: 0, devastationRemaining: 600 });
  });

  it("freezes when a side has overshot its threshold (negative remaining)", () => {
    const state = createTrackedPlanetState("planet_001", 1000);
    const next = appendTrackedSample(state, liveContestedPlanet(1200, 400), 2000);
    expect(next.frozen).toBe(true);
  });

  it("does not freeze while both sides still have points remaining", () => {
    const state = createTrackedPlanetState("planet_001", 1000);
    const next = appendTrackedSample(state, liveContestedPlanet(999, 999), 2000);
    expect(next.frozen).toBe(false);
  });
});

describe("restartIfRecontested", () => {
  const frozenState: TrackedPlanetState = {
    planetId: "planet_001",
    startedAtMs: 1000,
    samples: [{ atMs: 1500, imperialRemaining: 0, devastationRemaining: 500 }],
    frozen: true,
  };

  it("stays unchanged while still frozen and the planet is still sunk (mid-cooldown)", () => {
    const cooldownPlanet = planet({ struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 } });
    expect(restartIfRecontested(frozenState, cooldownPlanet, 5000)).toBe(frozenState);
  });

  it("starts a fresh state at the detection time once the planet is trackable again", () => {
    const next = restartIfRecontested(frozenState, liveContestedPlanet(10, 10), 5000);
    expect(next).toEqual({ planetId: "planet_001", startedAtMs: 5000, samples: [], frozen: false });
  });

  it("leaves a not-yet-frozen state alone even if the planet looks sunk (shouldn't happen, but never discards live progress)", () => {
    const live = createTrackedPlanetState("planet_001", 1000);
    const cooldownPlanet = planet({ struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 } });
    expect(restartIfRecontested(live, cooldownPlanet, 5000)).toBe(live);
  });
});

describe("formatAxisValue", () => {
  it("rounds to a single significant digit with a k/M/B suffix, matching the spec's own examples", () => {
    expect(formatAxisValue(923000)).toBe("900k");
    expect(formatAxisValue(72000000)).toBe("70M");
  });

  it("never exceeds 4 characters, including the worst-case 3-digit-plus-suffix values", () => {
    expect(formatAxisValue(900000000)).toBe("900M");
    expect(formatAxisValue(100000000000)).toBe("100B");
  });

  it("shows no suffix under 1000", () => {
    expect(formatAxisValue(5)).toBe("5");
    expect(formatAxisValue(923)).toBe("900");
  });

  it("rolls a rounded-up leading digit of 10 over into the next power of ten", () => {
    // 95 is nearest to 100 (a single "1" at the next decade), not "10" at this one.
    expect(formatAxisValue(95)).toBe("100");
  });

  it("returns \"0\" for zero (defensive - grid lines never actually reach 0, that's the baseline)", () => {
    expect(formatAxisValue(0)).toBe("0");
  });
});

describe("computeAxisScale", () => {
  it("seeds the ceiling from the first sample and grows immediately to match a later peak", () => {
    expect(computeAxisScale([5, 50, 500]).ceiling).toBe(500);
  });

  it("holds the ceiling steady through a dip that stays within one power of ten", () => {
    // 70 is itself a clean ceiling (7 x 10); 60 is within one decade of it (60 >= 7), so the
    // ceiling doesn't move even though the value dropped.
    expect(computeAxisScale([70, 60]).ceiling).toBe(70);
  });

  it("holds the ceiling steady across a whole run of decreasing-but-still-within-one-decade samples", () => {
    // Regression guard for the original (rejected) design: a *shrinking* ceiling that re-based to
    // every new value made the line always pin to the top of the chart, visually flat - exactly the
    // symptom grid lines/dual axes were meant to fix. A run of moderate decreases must leave the
    // ceiling in place throughout, not just for one step.
    expect(computeAxisScale([90, 80, 70, 60]).ceiling).toBe(90);
  });

  it("steps the ceiling down by exactly one power of ten when a value drops more than one decade below it - the spec's own example", () => {
    // Ceiling reaches >=10M, then a sample's own natural ceiling is <1M - the axis steps down to
    // exactly 1M (10M / 10), not all the way to the tiny value's own true decade.
    expect(computeAxisScale([10_000_000, 50_000]).ceiling).toBe(1_000_000);
  });

  it("skips a zero sample entirely rather than letting it collapse the ceiling", () => {
    expect(computeAxisScale([500_000, 0, 400_000]).ceiling).toBe(500_000);
  });

  it("produces one tick per single-digit multiple of the ceiling's own decade, each already a clean label", () => {
    const axis = computeAxisScale([10_000_000, 50_000]); // ceiling 1,000,000 (see above)
    expect(axis.ticks).toEqual([{ value: 1_000_000, normalizedY: 1, label: "1M" }]);
  });

  it("produces several ticks when the ceiling's leading digit is bigger than 1", () => {
    const axis = computeAxisScale([70]); // decade 10, k=7
    expect(axis.ticks.map((t) => t.label)).toEqual(["10", "20", "30", "40", "50", "60", "70"]);
    expect(axis.ticks[6]).toEqual({ value: 70, normalizedY: 1, label: "70" });
  });
});

describe("timeAxisStepSeconds", () => {
  it("matches the spec's own hand-picked tiers exactly, at and just past each threshold", () => {
    // [duration seconds to check, expected step seconds]
    const cases: [number, number][] = [
      [1, 10], // every 10s up to a minute
      [60, 10],
      [61, 30], // every 30s up to 3 minutes
      [180, 30],
      [181, 60], // every 1m up to 8 minutes
      [480, 60],
      [481, 120], // every 2m up to 16 minutes
      [960, 120],
      [961, 240], // every 4m up to 20 minutes
      [1200, 240],
      [1201, 300], // every 5m up to 25 minutes
      [1500, 300],
      [1501, 600], // every 10m up to 50 minutes
      [3000, 600],
      [3001, 1200], // every 20m up to 100 minutes
      [6000, 1200],
    ];
    for (const [durationSeconds, expectedStep] of cases) {
      expect(timeAxisStepSeconds(durationSeconds)).toBe(expectedStep);
    }
  });

  it("keeps extending the same 4x/5x/10x/20x-per-decade cycle past the spec's last given tier", () => {
    expect(timeAxisStepSeconds(6001)).toBe(2400); // every 40m, just past 100 minutes
    expect(timeAxisStepSeconds(12000)).toBe(2400); // ... up to 200 minutes
    expect(timeAxisStepSeconds(12001)).toBe(3000); // every 50m from there
  });
});

describe("computeTrackerGraphPoints", () => {
  it("returns empty output for a state with no samples yet", () => {
    expect(computeTrackerGraphPoints(createTrackedPlanetState("planet_001", 1000))).toEqual({
      imperial: [],
      devastation: [],
      imperialAxis: { ceiling: 0, ticks: [] },
      devastationAxis: { ceiling: 0, ticks: [] },
      timeTicks: [],
      imperialLabel: null,
      devastationLabel: null,
    });
  });

  it("renders a single sample at the top of its own (single-sample) scale for both sides", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [{ atMs: 1000, imperialRemaining: 500, devastationRemaining: 300 }],
      frozen: false,
    };
    const result = computeTrackerGraphPoints(state);
    expect(result.imperial).toEqual([{ x: 0, y: 1 }]);
    expect(result.devastation).toEqual([{ x: 0, y: 1 }]);
  });

  it("keeps a trailing side's line visibly moving on its own scale, even when it's orders of magnitude behind the other side", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 900_000, devastationRemaining: 90 },
        { atMs: 1000, imperialRemaining: 450_000, devastationRemaining: 45 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphPoints(state);
    // Both lines fall to half their own starting height - devastation is nowhere near flat/pinned
    // to 0 despite being ~10,000x smaller in absolute terms than imperial.
    expect(result.imperial.map((p) => p.y)).toEqual([1, 0.5]);
    expect(result.devastation.map((p) => p.y)).toEqual([1, 0.5]);
  });

  it("clamps an older, higher sample to the top of the chart once the axis has since stepped down", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 10_000_000, devastationRemaining: 500 },
        { atMs: 1000, imperialRemaining: 50_000, devastationRemaining: 500 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphPoints(state);
    // Ceiling steps down to 1M (see computeAxisScale's own test) - the first sample (10M) is now
    // far above that, so it clamps to 1 rather than escaping the plot area.
    expect(result.imperial[0].y).toBe(1);
    expect(result.imperial[1].y).toBeCloseTo(0.05); // 50,000 / 1,000,000
  });

  it("always labels both lines at their own last point, in raw remaining-value terms", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [{ atMs: 0, imperialRemaining: 50, devastationRemaining: 900 }],
      frozen: false,
    };
    const result = computeTrackerGraphPoints(state);
    // Single sample -> each side's own ceiling equals that sample's value, so y is 1 for both,
    // regardless of the 50 vs 900 gap - each label's `value` still carries the real raw number.
    expect(result.imperialLabel).toEqual({ x: 0, y: 1, value: 50 });
    expect(result.devastationLabel).toEqual({ x: 0, y: 1, value: 900 });
  });

  it("still labels both lines even on an exact tie (no more XOR - which side renders above/below is a rendering decision, not made here)", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [{ atMs: 0, imperialRemaining: 300, devastationRemaining: 300 }],
      frozen: false,
    };
    const result = computeTrackerGraphPoints(state);
    expect(result.imperialLabel).toEqual({ x: 0, y: 1, value: 300 });
    expect(result.devastationLabel).toEqual({ x: 0, y: 1, value: 300 });
  });

  it("spaces time ticks by timeAxisStepSeconds's own step, not a fixed fraction of the duration", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 100, devastationRemaining: 100 },
        { atMs: 40_000, imperialRemaining: 50, devastationRemaining: 50 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphPoints(state);
    // 40s total duration -> still under the "every 10s up to a minute" tier.
    expect(result.timeTicks).toEqual([
      { normalizedX: 0, label: "0s" },
      { normalizedX: 0.25, label: "10s" },
      { normalizedX: 0.5, label: "20s" },
      { normalizedX: 0.75, label: "30s" },
      { normalizedX: 1, label: "40s" },
    ]);
  });

  it("switches to a coarser step (and so fewer ticks) once the duration crosses a tier boundary, formatting minute-plus labels as M:SS", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 100, devastationRemaining: 100 },
        { atMs: 90_000, imperialRemaining: 50, devastationRemaining: 50 },
      ],
      frozen: false,
    };
    // 90s total duration -> past the 60s tier, now every 30s (not 10s) - 4 ticks, not 9.
    const result = computeTrackerGraphPoints(state);
    expect(result.timeTicks).toEqual([
      { normalizedX: 0, label: "0s" },
      { normalizedX: 1 / 3, label: "30s" },
      { normalizedX: 2 / 3, label: "1:00" },
      { normalizedX: 1, label: "1:30" },
    ]);
  });

  it("has no time ticks with fewer than two samples", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [{ atMs: 1000, imperialRemaining: 500, devastationRemaining: 300 }],
      frozen: false,
    };
    expect(computeTrackerGraphPoints(state).timeTicks).toEqual([]);
  });
});

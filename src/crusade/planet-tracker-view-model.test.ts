import { describe, expect, it } from "vitest";
import {
  appendTrackedSample,
  computeAxisScale,
  computeTrackerGraphData,
  createTrackedPlanetState,
  formatAxisValue,
  formatElapsedSeconds,
  mergeHistoryIntoTrackedPlanetState,
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

describe("mergeHistoryIntoTrackedPlanetState", () => {
  it("is a no-op for an empty history", () => {
    const state = createTrackedPlanetState("planet_001", 5000);
    expect(mergeHistoryIntoTrackedPlanetState(state, [])).toBe(state);
  });

  it("prepends history and moves startedAtMs back to the earliest sample", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 5000,
      samples: [{ atMs: 5000, imperialRemaining: 400, devastationRemaining: 300 }],
      frozen: false,
    };
    const history = [
      { atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 },
      { atMs: 2000, imperialRemaining: 700, devastationRemaining: 600 },
    ];
    const result = mergeHistoryIntoTrackedPlanetState(state, history);
    expect(result.startedAtMs).toBe(1000);
    expect(result.samples).toEqual([...history, { atMs: 5000, imperialRemaining: 400, devastationRemaining: 300 }]);
    expect(result.frozen).toBe(false);
  });

  it("stays frozen when the live state was already frozen", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 5000,
      samples: [{ atMs: 5000, imperialRemaining: 0, devastationRemaining: 300 }],
      frozen: true,
    };
    const history = [{ atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 }];
    expect(mergeHistoryIntoTrackedPlanetState(state, history).frozen).toBe(true);
  });

  it("freezes the merged state when the history's own last sample already shows a capture, even if the live state wasn't frozen yet", () => {
    const state = createTrackedPlanetState("planet_001", 5000);
    const history = [
      { atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 },
      { atMs: 2000, imperialRemaining: 0, devastationRemaining: 600 },
    ];
    expect(mergeHistoryIntoTrackedPlanetState(state, history).frozen).toBe(true);
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

  it("never shrinks the ceiling, no matter how far or how many samples a value drops - the axis is static once a peak is set", () => {
    // A previous design dynamically shrank the ceiling over time and it looked bad in practice, so
    // this is a direct regression guard: even a huge, multi-step drop (10M all the way down to 50)
    // must leave the ceiling exactly where its peak left it.
    expect(computeAxisScale([90, 80, 70, 60]).ceiling).toBe(90);
    expect(computeAxisScale([10_000_000, 50]).ceiling).toBe(10_000_000);
  });

  it("skips a zero sample entirely rather than letting it collapse the ceiling", () => {
    expect(computeAxisScale([500_000, 0, 400_000]).ceiling).toBe(500_000);
  });

  it("produces one tick per single-digit multiple of the ceiling's own decade, each already a clean label", () => {
    const axis = computeAxisScale([1_000_000]); // decade 1,000,000, k=1
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

describe("computeTrackerGraphData", () => {
  it("returns empty output for a state with no samples yet", () => {
    const emptyAxis = { ceiling: 0, ticks: [] };
    const emptyLine = { points: [], values: [], label: null };
    expect(computeTrackerGraphData(createTrackedPlanetState("planet_001", 1000))).toEqual({
      imperial: { line: emptyLine, axis: emptyAxis },
      devastation: { line: emptyLine, axis: emptyAxis },
      combined: { imperial: emptyLine, devastation: emptyLine, axis: emptyAxis },
      timeTicks: [],
      sampleElapsedSeconds: [],
    });
  });

  it("renders a single sample at the top of each side's own solo scale, but proportionally on the shared combined scale", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [{ atMs: 1000, imperialRemaining: 500, devastationRemaining: 300 }],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
    // Solo: each side's own ceiling equals its own value, so both read "1" - exactly the
    // misleading behavior the Combined graph exists to fix.
    expect(result.imperial.line.points).toEqual([{ x: 0, y: 1 }]);
    expect(result.devastation.line.points).toEqual([{ x: 0, y: 1 }]);
    // Combined: one shared ceiling (500, the larger side's own) - devastation's 300 now honestly
    // reads as 60% of imperial's, not equal to it.
    expect(result.combined.axis.ceiling).toBe(500);
    expect(result.combined.imperial.points).toEqual([{ x: 0, y: 1 }]);
    expect(result.combined.devastation.points).toEqual([{ x: 0, y: 0.6 }]);
  });

  it("carries each sample's raw remaining value alongside its normalized point (for the hover tooltip)", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 500, devastationRemaining: 300 },
        { atMs: 1000, imperialRemaining: 250, devastationRemaining: 150 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
    expect(result.imperial.line.values).toEqual([500, 250]);
    expect(result.devastation.line.values).toEqual([300, 150]);
    // Combined lines report the same raw values too, even though their normalized points differ
    // from the solo lines (shared axis).
    expect(result.combined.imperial.values).toEqual([500, 250]);
    expect(result.combined.devastation.values).toEqual([300, 150]);
  });

  it("keeps a trailing side's SOLO line visibly moving on its own scale, even when it's orders of magnitude behind the other side", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 900_000, devastationRemaining: 90 },
        { atMs: 1000, imperialRemaining: 450_000, devastationRemaining: 45 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
    // Both solo lines fall to half their own starting height - devastation's solo graph is nowhere
    // near flat/pinned to 0 despite being ~10,000x smaller in absolute terms than imperial.
    expect(result.imperial.line.points.map((p) => p.y)).toEqual([1, 0.5]);
    expect(result.devastation.line.points.map((p) => p.y)).toEqual([1, 0.5]);
    // The Combined graph accepts the opposite tradeoff on purpose: one honest shared scale means
    // devastation's line is legitimately squashed near 0 there - that's exactly why the solo graphs
    // still exist alongside it, not a bug in the combined one.
    expect(result.combined.axis.ceiling).toBe(900_000);
    expect(result.combined.devastation.points.every((p) => p.y < 0.001)).toBe(true);
  });

  it("keeps every axis fixed at its peak even after a huge drop - no rescaling, on any of the three graphs", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 10_000_000, devastationRemaining: 500 },
        { atMs: 1000, imperialRemaining: 50_000, devastationRemaining: 500 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
    // Imperial's solo ceiling stays at its peak (10M) for the whole line.
    expect(result.imperial.line.points[0].y).toBe(1);
    expect(result.imperial.line.points[1].y).toBeCloseTo(0.005); // 50,000 / 10,000,000
    // The Combined axis (10M, the larger side's peak) never shrinks either.
    expect(result.combined.axis.ceiling).toBe(10_000_000);
  });

  it("always labels every line at its own last point, in raw remaining-value terms", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [{ atMs: 0, imperialRemaining: 50, devastationRemaining: 900 }],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
    // Solo: each side's own ceiling equals that sample's value, so y is 1 for both, regardless of
    // the 50 vs 900 gap - each label's `value` still carries the real raw number.
    expect(result.imperial.line.label).toEqual({ x: 0, y: 1, value: 50 });
    expect(result.devastation.line.label).toEqual({ x: 0, y: 1, value: 900 });
    // Combined: same shared ceiling (900, the larger side's) for both labels' positions, but each
    // still reports its own true value.
    expect(result.combined.imperial.label).toEqual({ x: 0, y: 50 / 900, value: 50 });
    expect(result.combined.devastation.label).toEqual({ x: 0, y: 1, value: 900 });
  });

  it("still labels every line even on an exact tie", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [{ atMs: 0, imperialRemaining: 300, devastationRemaining: 300 }],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
    expect(result.imperial.line.label).toEqual({ x: 0, y: 1, value: 300 });
    expect(result.devastation.line.label).toEqual({ x: 0, y: 1, value: 300 });
    expect(result.combined.imperial.label).toEqual({ x: 0, y: 1, value: 300 });
    expect(result.combined.devastation.label).toEqual({ x: 0, y: 1, value: 300 });
  });

  it("spaces time ticks by timeAxisStepSeconds's own step, not a fixed fraction of the duration - shared by all three graphs", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 100, devastationRemaining: 100 },
        { atMs: 40_000, imperialRemaining: 50, devastationRemaining: 50 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
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
    const result = computeTrackerGraphData(state);
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
    expect(computeTrackerGraphData(state).timeTicks).toEqual([]);
  });

  it("formats time tick labels as HH:mm:ss once the duration crosses an hour", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 0,
      samples: [
        { atMs: 0, imperialRemaining: 100, devastationRemaining: 100 },
        { atMs: 3_600_000, imperialRemaining: 50, devastationRemaining: 50 },
      ],
      frozen: false,
    };
    const result = computeTrackerGraphData(state);
    expect(result.timeTicks.map((t) => t.label)).toContain("1:00:00");
  });

  it("reports each sample's elapsed seconds since the first one, for the hover tooltip", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [
        { atMs: 1000, imperialRemaining: 100, devastationRemaining: 100 },
        { atMs: 1000 + 65_000, imperialRemaining: 50, devastationRemaining: 50 },
      ],
      frozen: false,
    };
    expect(computeTrackerGraphData(state).sampleElapsedSeconds).toEqual([0, 65]);
  });
});

describe("formatElapsedSeconds", () => {
  it("formats under a minute as plain seconds", () => {
    expect(formatElapsedSeconds(0)).toBe("0s");
    expect(formatElapsedSeconds(45)).toBe("45s");
    expect(formatElapsedSeconds(59)).toBe("59s");
  });

  it("formats a minute or more, but under an hour, as m:ss", () => {
    expect(formatElapsedSeconds(60)).toBe("1:00");
    expect(formatElapsedSeconds(65)).toBe("1:05");
    expect(formatElapsedSeconds(3599)).toBe("59:59");
  });

  it("formats an hour or more as h:mm:ss", () => {
    expect(formatElapsedSeconds(3600)).toBe("1:00:00");
    expect(formatElapsedSeconds(3665)).toBe("1:01:05");
    expect(formatElapsedSeconds(7384)).toBe("2:03:04");
  });
});

import { describe, expect, it } from "vitest";
import {
  appendTrackedSample,
  captureUrgency,
  computeAxisScale,
  computeHourlyAccruedRate,
  computeTotalHourlyRate,
  computeTrackerGraphData,
  createTrackedPlanetState,
  formatAxisValue,
  formatCompactSignedPoints,
  formatElapsedSeconds,
  liveSnapshotSample,
  mergeHistoryIntoTrackedPlanetState,
  restartIfRecontested,
  timeAxisStepSeconds,
  trackedStateFromHistory,
  type TrackedPlanetSample,
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
    expect(next.samples).toEqual([
      {
        atMs: 2000,
        imperialRemaining: 900,
        devastationRemaining: 800,
        imperialAccrued: 100,
        devastationAccrued: 200,
        imperialThreshold: 1000,
        devastationThreshold: 1000,
      },
    ]);
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
    expect(next.samples[0]).toEqual({
      atMs: 2000,
      imperialRemaining: 0,
      devastationRemaining: 600,
      imperialAccrued: 1000,
      devastationAccrued: 400,
      imperialThreshold: 1000,
      devastationThreshold: 1000,
    });
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

describe("trackedStateFromHistory", () => {
  it("builds an empty, un-frozen state for a planet with no recorded history yet", () => {
    expect(trackedStateFromHistory("planet_001", [], 5000)).toEqual({
      planetId: "planet_001",
      startedAtMs: 5000,
      samples: [],
      frozen: false,
    });
  });

  it("starts at the earliest sample and isn't frozen while both sides still have points left", () => {
    const history = [
      { atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 },
      { atMs: 2000, imperialRemaining: 700, devastationRemaining: 600 },
    ];
    expect(trackedStateFromHistory("planet_001", history, 5000)).toEqual({
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: history,
      frozen: false,
    });
  });

  it("is frozen when the last recorded sample already shows a capture", () => {
    const history = [
      { atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 },
      { atMs: 2000, imperialRemaining: 0, devastationRemaining: 600 },
    ];
    expect(trackedStateFromHistory("planet_001", history, 5000).frozen).toBe(true);
  });
});

describe("liveSnapshotSample", () => {
  it("builds a sample from the planet's current remaining points, timestamped now", () => {
    expect(liveSnapshotSample(liveContestedPlanet(100, 50), 5000)).toEqual({
      atMs: 5000,
      imperialRemaining: 900,
      devastationRemaining: 950,
      imperialAccrued: 100,
      devastationAccrued: 50,
      imperialThreshold: 1000,
      devastationThreshold: 1000,
    });
  });

  it("returns null for a planet with no struggleData (pointsRemaining is Infinity)", () => {
    expect(liveSnapshotSample(planet(), 5000)).toBeNull();
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

describe("resolveRemaining (via computeTrackerGraphData)", () => {
  it("prefers threshold - accrued over the legacy remaining field when both new fields are present", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [
        // Legacy remaining says 900, but accrued/threshold say the honest value is 850 - the
        // graph should plot 850, not 900, whenever both new fields are available.
        { atMs: 1000, imperialRemaining: 900, devastationRemaining: 500, imperialAccrued: 150, imperialThreshold: 1000, devastationAccrued: 500, devastationThreshold: 1000 },
      ],
      frozen: false,
    };
    expect(computeTrackerGraphData(state).imperial.line.values).toEqual([850]);
  });

  it("falls back to the legacy remaining field when either new field is missing on a sample", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [{ atMs: 1000, imperialRemaining: 900, devastationRemaining: 500 }],
      frozen: false,
    };
    expect(computeTrackerGraphData(state).imperial.line.values).toEqual([900]);
  });

  it("resolves each sample independently in a mixed array (legacy then new)", () => {
    const state: TrackedPlanetState = {
      planetId: "planet_001",
      startedAtMs: 1000,
      samples: [
        { atMs: 1000, imperialRemaining: 900, devastationRemaining: 500 },
        { atMs: 2000, imperialRemaining: 999, devastationRemaining: 500, imperialAccrued: 200, imperialThreshold: 1000, devastationAccrued: 500, devastationThreshold: 1000 },
      ],
      frozen: false,
    };
    // First sample has no new fields -> legacy 900. Second has both -> 1000 - 200 = 800, not 999.
    expect(computeTrackerGraphData(state).imperial.line.values).toEqual([900, 800]);
  });
});

describe("computeTrackerGraphData with a time window", () => {
  const HOUR = 60 * 60 * 1000;
  const samples: TrackedPlanetSample[] = [
    { atMs: 0, imperialRemaining: 100, devastationRemaining: 100 },
    { atMs: 2 * HOUR, imperialRemaining: 90, devastationRemaining: 90 },
    { atMs: 3.9 * HOUR, imperialRemaining: 80, devastationRemaining: 80 },
  ];
  const state: TrackedPlanetState = { planetId: "planet_001", startedAtMs: 0, samples, frozen: false };

  it("anchors the right edge to nowMs, not to the last sample's own (possibly stale) timestamp", () => {
    // The last real sample is 6 minutes (0.1h) stale relative to "now" - without windowing, the
    // axis would derive its bounds from that sample's own timestamp and plot it at x=1 (as if it
    // were current). With the window anchored to the real nowMs, it must land short of the right
    // edge instead, honestly reflecting that staleness.
    const nowMs = 4 * HOUR;
    const data = computeTrackerGraphData(state, { startMs: nowMs - 4 * HOUR, endMs: nowMs });
    const lastPoint = data.imperial.line.points[data.imperial.line.points.length - 1];
    expect(lastPoint.x).toBeCloseTo(3.9 / 4, 5);
    expect(lastPoint.x).toBeLessThan(1);
  });

  it("drops samples outside the window entirely from the lines and axis scale", () => {
    const nowMs = 3.9 * HOUR;
    // A 1h window only reaches back to 2.9h - the 0h and 2h samples are both outside it.
    const data = computeTrackerGraphData(state, { startMs: nowMs - HOUR, endMs: nowMs });
    expect(data.imperial.line.points).toHaveLength(1);
    expect(data.imperial.line.values).toEqual([80]);
  });

  it("still frames the axis to the exact window even when no samples fall inside it", () => {
    const nowMs = 100 * HOUR; // far past every recorded sample
    const data = computeTrackerGraphData(state, { startMs: nowMs - HOUR, endMs: nowMs });
    expect(data.imperial.line.points).toEqual([]);
    expect(data.imperial.line.label).toBeNull();
    expect(data.timeTicks.length).toBeGreaterThan(0); // the 1h-wide frame itself still has ticks
  });

  it("falls back to natural sample-derived bounds when no window is given", () => {
    const data = computeTrackerGraphData(state);
    expect(data.imperial.line.points).toHaveLength(3);
    expect(data.imperial.line.points[0].x).toBe(0);
    expect(data.imperial.line.points[2].x).toBe(1);
  });
});

describe("computeHourlyAccruedRate", () => {
  it("interpolates the value exactly one hour ago from two bracketing samples (the common case)", () => {
    const nowMs = 2 * 60 * 60 * 1000;
    const samples = [
      { atMs: 0, value: 0 },
      { atMs: 60 * 60 * 1000, value: 100 }, // exactly 1h ago: value 100
      { atMs: 90 * 60 * 1000, value: 150 },
    ];
    // currentValue 300, value 1h ago is 100 -> rate 200/hr.
    expect(computeHourlyAccruedRate(samples, 300, nowMs)).toBe(200);
  });

  it("interpolates between two samples that aren't exactly an hour apart", () => {
    const nowMs = 2 * 60 * 60 * 1000;
    const samples = [
      { atMs: 0, value: 0 },
      { atMs: 90 * 60 * 1000, value: 90 }, // 90 minutes in, value 90 -> 1/min
    ];
    // 1h ago (60min) interpolates to 60 (linear from (0,0) to (90,90)).
    expect(computeHourlyAccruedRate(samples, 160, nowMs)).toBe(100);
  });

  it("falls back to the since-start rate, scaled to a full hour, when under an hour of data exists", () => {
    const nowMs = 30 * 60 * 1000; // only 30 minutes of history
    const samples = [{ atMs: 0, value: 50 }];
    // Gained 25 points in 30 minutes -> 50 points/hour.
    expect(computeHourlyAccruedRate(samples, 75, nowMs)).toBe(50);
  });

  it("returns 0 for an empty sample array", () => {
    expect(computeHourlyAccruedRate([], 100, 10_000)).toBe(0);
  });

  it("returns 0 rather than dividing by ~zero when elapsedMinutes is non-positive", () => {
    const samples = [{ atMs: 10_000, value: 50 }];
    expect(computeHourlyAccruedRate(samples, 60, 10_000)).toBe(0);
  });
});

describe("captureUrgency", () => {
  it("is 'imminent' when capture is at most an hour away", () => {
    expect(captureUrgency(100, 100)).toBe("imminent"); // exactly 1h
    expect(captureUrgency(50, 100)).toBe("imminent"); // 0.5h
  });

  it("is 'withinTwoHours' between one and two hours away", () => {
    expect(captureUrgency(150, 100)).toBe("withinTwoHours"); // 1.5h
    expect(captureUrgency(200, 100)).toBe("withinTwoHours"); // exactly 2h
  });

  it("is 'withinFourHours' between two and four hours away", () => {
    expect(captureUrgency(300, 100)).toBe("withinFourHours"); // 3h
    expect(captureUrgency(400, 100)).toBe("withinFourHours"); // exactly 4h
  });

  it("is 'normal' beyond four hours away", () => {
    expect(captureUrgency(401, 100)).toBe("normal");
  });

  it("is 'normal' for a non-positive rate, regardless of pointsRemaining", () => {
    expect(captureUrgency(100, 0)).toBe("normal");
    expect(captureUrgency(100, -50)).toBe("normal");
  });

  it("is 'normal' once the planet is already captured (pointsRemaining <= 0)", () => {
    expect(captureUrgency(0, 100)).toBe("normal");
    expect(captureUrgency(-10, 100)).toBe("normal");
  });
});

describe("formatCompactSignedPoints", () => {
  it("floors to the exact k/M/B tier rather than rounding to one significant digit", () => {
    expect(formatCompactSignedPoints(22_718_965)).toBe("+22M");
    expect(formatCompactSignedPoints(765_987)).toBe("+765k");
  });

  it("signs negative values with a leading -", () => {
    expect(formatCompactSignedPoints(-765_987)).toBe("-765k");
  });

  it("handles billions and sub-thousand values", () => {
    expect(formatCompactSignedPoints(2_500_000_000)).toBe("+2B");
    expect(formatCompactSignedPoints(42)).toBe("+42");
  });
});

describe("computeTotalHourlyRate", () => {
  const HOUR = 60 * 60 * 1000;
  const nowMs = 2 * HOUR;

  it("sums each planet's own hourly rate per side across the whole map", () => {
    const planets = [liveContestedPlanet(200, 100), liveContestedPlanet(150, 50)];
    planets[0].planetId = "planet_a";
    planets[1].planetId = "planet_b";
    // Two real samples each, bracketing the 1h-ago mark cleanly (atMs=0 and atMs=2h, matching
    // nowMs) so computeHourlyAccruedRate takes its primary interpolation path, not the
    // since-start fallback - avoids the single-sample edge case entirely for a predictable sum.
    const historyByPlanet = new Map<string, TrackedPlanetSample[]>([
      [
        "planet_a",
        [
          { atMs: 0, imperialRemaining: 1000, devastationRemaining: 1000, imperialAccrued: 0, devastationAccrued: 0, imperialThreshold: 1000, devastationThreshold: 1000 },
          { atMs: 2 * HOUR, imperialRemaining: 800, devastationRemaining: 900, imperialAccrued: 200, devastationAccrued: 100, imperialThreshold: 1000, devastationThreshold: 1000 },
        ],
      ],
      [
        "planet_b",
        [
          { atMs: 0, imperialRemaining: 1000, devastationRemaining: 1000, imperialAccrued: 0, devastationAccrued: 0, imperialThreshold: 1000, devastationThreshold: 1000 },
          { atMs: 2 * HOUR, imperialRemaining: 850, devastationRemaining: 950, imperialAccrued: 150, devastationAccrued: 50, imperialThreshold: 1000, devastationThreshold: 1000 },
        ],
      ],
    ]);
    // Interpolated value 1h ago is the midpoint of each pair (linear between t=0 and t=2h):
    // planet_a imperial: 0 -> 200 interpolates to 100 at 1h -> rate = currentValue(200) - 100 = 100/hr.
    // planet_b imperial: 0 -> 150 interpolates to 75 at 1h -> rate = currentValue(150) - 75 = 75/hr.
    // Summed: 175/hr imperial. Devastation: (100-50)+(50-25) = 50+25 = 75/hr.
    const result = computeTotalHourlyRate(planets, historyByPlanet, nowMs);
    expect(result.imperial).toBe(175);
    expect(result.devastation).toBe(75);
  });

  it("contributes 0 for a planet with no struggleData or no history", () => {
    const noStruggle = planet({ planetId: "planet_c" });
    const noHistory = liveContestedPlanet(100, 100);
    noHistory.planetId = "planet_d";
    const result = computeTotalHourlyRate([noStruggle, noHistory], new Map(), nowMs);
    expect(result).toEqual({ imperial: 0, devastation: 0 });
  });
});

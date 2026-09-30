import type { CrusadePlanet } from "../api/types";
import { isPlanetTrackable } from "./tracked-planet";
import { pointsRemaining } from "./crusade-domination-view-model";

export interface TrackedPlanetSample {
  atMs: number;
  imperialRemaining: number;
  devastationRemaining: number;
}

export interface TrackedPlanetState {
  planetId: string;
  startedAtMs: number;
  samples: TrackedPlanetSample[];
  // Once true, appendTrackedSample stops adding points - the graph stays exactly where it was the
  // instant either side reached its capture threshold.
  frozen: boolean;
}

export function createTrackedPlanetState(planetId: string, nowMs: number): TrackedPlanetState {
  return { planetId, startedAtMs: nowMs, samples: [], frozen: false };
}

// Appends one sample per refresh. A no-op once frozen - the graph is meant to freeze in place, not
// keep silently accumulating samples behind the scenes. Freezes *on* the sample that first shows
// either side at 0 (or negative) remaining, so the last point drawn is the capture point itself.
export function appendTrackedSample(state: TrackedPlanetState, planet: CrusadePlanet, nowMs: number): TrackedPlanetState {
  if (state.frozen) return state;
  const remaining = pointsRemaining(planet);
  const sample: TrackedPlanetSample = { atMs: nowMs, imperialRemaining: remaining.imperial, devastationRemaining: remaining.devastation };
  const frozen = remaining.imperial <= 0 || remaining.devastation <= 0;
  return { ...state, samples: [...state.samples, sample], frozen };
}

// "If they've had a planet tracked long enough that it was captured, went through cooldown, and is
// contested again, start the graph over at the point in time we detect that" - called before each
// tick's appendTrackedSample. Only resets when frozen (never discards live progress) and only once
// the planet is trackable again (no longer sunk) - a still-sunk (mid-cooldown) planet stays frozen
// as-is.
export function restartIfRecontested(state: TrackedPlanetState, planet: CrusadePlanet, nowMs: number): TrackedPlanetState {
  if (!state.frozen) return state;
  if (!isPlanetTrackable(planet)) return state;
  return createTrackedPlanetState(state.planetId, nowMs);
}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface LabeledPoint {
  x: number;
  y: number;
  value: number;
}

export interface AxisTick {
  value: number;
  // Normalized [0,1] against this same axis's own ceiling - 0 is the baseline, 1 is the ceiling.
  normalizedY: number;
  label: string;
}

export interface SideAxis {
  ceiling: number;
  ticks: AxisTick[];
}

export interface TimeTick {
  normalizedX: number;
  label: string;
}

export interface TrackerGraphPoints {
  imperial: GraphPoint[];
  devastation: GraphPoint[];
  imperialAxis: SideAxis;
  devastationAxis: SideAxis;
  timeTicks: TimeTick[];
  // Both lines are always labeled at their rightmost (most recent) point, unlike the single
  // XOR-picked label this used to be - with two independent per-side axes there's no longer one
  // "closer to zero" answer that means anything across both scales. Which one renders above/below
  // its point (so the two labels don't overlap) is a rendering decision made in the .tsx component,
  // which already has the shared pixel mapping needed to compare the two points' screen positions.
  imperialLabel: LabeledPoint | null;
  devastationLabel: LabeledPoint | null;
}

const EMPTY_GRAPH_POINTS: TrackerGraphPoints = {
  imperial: [],
  devastation: [],
  imperialAxis: { ceiling: 0, ticks: [] },
  devastationAxis: { ceiling: 0, ticks: [] },
  timeTicks: [],
  imperialLabel: null,
  devastationLabel: null,
};

// Ceiling used before any real (positive) sample has been seen - only matters for a degenerate
// all-zero series, which shouldn't happen in practice (a trackable planet always starts with
// positive remaining points on both sides).
const MIN_CEILING = 10;

// The power of ten at or below v (e.g. 923 -> 100, 50000 -> 10000). Never called with v <= 0.
function decadeOf(v: number): number {
  return 10 ** Math.floor(Math.log10(v));
}

// The smallest "single significant digit times a power of ten" value that's >= v (e.g. 923 -> 900
// is wrong - this rounds UP to cover v, so 923 -> 1000; a tick's own VALUE always covers at least
// as much as the sample that produced it). Doubles as the y-axis grid line values once folded into
// a ceiling below - every value this function can produce is, by construction, representable as a
// single digit 1-9 times a power of ten.
function rawCeiling(v: number): number {
  const decade = decadeOf(v);
  return Math.ceil(v / decade) * decade;
}

// Folds a side's whole chronological sample history into one axis ceiling - this is what makes the
// axis "remember" a recent peak instead of hugging whatever the single latest sample happens to be
// (which would make the line always end pinned to the top of the chart, visually flat, exactly what
// grid lines/dual axes were meant to fix). Three cases per sample, applied in order:
//   - a new peak (this sample's own natural ceiling exceeds the running one) - adopt it immediately,
//     no damping needed for growth;
//   - a small dip (within one power of ten of the running ceiling) - leave the ceiling exactly where
//     it is, so a lead that's merely narrowing doesn't itself trigger a rescale;
//   - a big drop (more than one power of ten below the running ceiling - the "two powers of ten from
//     the displayed graph" case) - step the ceiling down by exactly one power of ten, never further
//     in a single sample, so the axis never jumps straight to the new tiny value. Reproduces the
//     spec's own example: a running ceiling >=10M, a sample whose own natural ceiling is <1M, steps
//     the axis down to exactly 1M (10M / 10), not the far smaller value's true decade.
// A sample of exactly 0 (that side already fully captured/depleted) is skipped entirely - it
// shouldn't itself drag a still-live axis down.
function foldAxisCeiling(values: readonly number[]): number {
  let ceiling = MIN_CEILING;
  let seeded = false;
  for (const v of values) {
    if (v <= 0) continue;
    const raw = rawCeiling(v);
    if (!seeded) {
      ceiling = raw;
      seeded = true;
      continue;
    }
    if (raw > ceiling) {
      ceiling = raw;
    } else if (raw < ceiling / 10) {
      ceiling = ceiling / 10;
    }
    // else: within one decade below the current ceiling - hold steady.
  }
  return ceiling;
}

// Formats a value to at most 4 characters, always a single significant digit (e.g. 923000 -> "900k",
// 72000000 -> "70M", never "923k"/"72M"/"72.3M") - used for every axis tick label. Not used for the
// labeled-point callout, which keeps its full-precision toLocaleString() display; only grid lines
// were asked to be this compact.
export function formatAxisValue(value: number): string {
  if (value <= 0) return "0";
  let n = Math.floor(Math.log10(value));
  let k = Math.round(value / 10 ** n);
  if (k >= 10) {
    k = 1;
    n += 1;
  }
  const tier = Math.floor(n / 3) * 3; // 0 -> "", 3 -> "k", 6 -> "M", 9 -> "B"
  const suffix = tier === 9 ? "B" : tier === 6 ? "M" : tier === 3 ? "k" : "";
  const displayNumber = k * 10 ** (n - tier);
  return `${displayNumber}${suffix}`;
}

// One side's independent scale: a ceiling folded from its own sample history (see
// foldAxisCeiling), plus one grid-line tick per single-digit multiple of the ceiling's own decade
// up to the ceiling itself - always clean single-significant-digit values by construction, so no
// separate rounding step is needed for the tick values (only for arbitrary/unrounded numbers, which
// don't occur here).
export function computeAxisScale(values: readonly number[]): SideAxis {
  const ceiling = foldAxisCeiling(values);
  const decade = decadeOf(ceiling);
  const k = Math.round(ceiling / decade);
  const ticks: AxisTick[] = [];
  for (let n = 1; n <= k; n++) {
    const value = n * decade;
    ticks.push({ value, normalizedY: value / ceiling, label: formatAxisValue(value) });
  }
  return { ceiling, ticks };
}

function formatElapsedSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// The first few tiers of the time axis's tick spacing are hand-picked (not one clean formula) -
// while total elapsed time is at most thresholdSeconds, use stepSeconds between grid lines.
const TIME_AXIS_LEAD_TIERS: readonly { thresholdSeconds: number; stepSeconds: number }[] = [
  { thresholdSeconds: 60, stepSeconds: 10 }, // every 10s up to a minute
  { thresholdSeconds: 180, stepSeconds: 30 }, // every 30s up to 3 minutes
  { thresholdSeconds: 480, stepSeconds: 60 }, // every 1m up to 8 minutes
  { thresholdSeconds: 960, stepSeconds: 120 }, // every 2m up to 16 minutes
];
// From here on the step cycles through 4x/5x/10x/20x a power of ten (in minutes) - 4,5,10,20, then
// 40,50,100,200, then 400,500,1000,2000, ... - each held until 5x its own value has elapsed. This
// reproduces the spec's own tail exactly (every 4m to 20m, every 5m to 25m, every 10m to 50m, every
// 20m to 100m) and keeps extending the same way indefinitely beyond that.
const TIME_AXIS_CYCLE_MINUTE_MULTIPLIERS = [4, 5, 10, 20] as const;

export function timeAxisStepSeconds(durationSeconds: number): number {
  for (const tier of TIME_AXIS_LEAD_TIERS) {
    if (durationSeconds <= tier.thresholdSeconds) return tier.stepSeconds;
  }
  let decade = 1;
  for (;;) {
    for (const multiplier of TIME_AXIS_CYCLE_MINUTE_MULTIPLIERS) {
      const stepSeconds = multiplier * decade * 60;
      if (durationSeconds <= stepSeconds * 5) return stepSeconds;
    }
    decade *= 10;
  }
}

// One vertical grid line every timeAxisStepSeconds(...) starting at 0, up to (not necessarily
// exactly reaching) the current elapsed duration - unlike the value axes, elapsed time isn't
// logarithmic, so no significant-digit rounding applies here, just a compact "Ns" / "M:SS" format.
// No ticks yet with fewer than two samples (no time range to divide).
function computeTimeTicks(samples: readonly TrackedPlanetSample[]): TimeTick[] {
  if (samples.length < 2) return [];
  const durationMs = samples[samples.length - 1].atMs - samples[0].atMs;
  if (durationMs <= 0) return [];
  const durationSeconds = durationMs / 1000;
  const step = timeAxisStepSeconds(durationSeconds);
  const ticks: TimeTick[] = [];
  for (let s = 0; s <= durationSeconds; s += step) {
    ticks.push({ normalizedX: s / durationSeconds, label: formatElapsedSeconds(Math.round(s)) });
  }
  return ticks;
}

// Normalizes samples into [0,1] x/y space for the .tsx component's own pixel mapper: x is elapsed
// time since the first sample (0 = first sample, 1 = the last sample - i.e. "now" while live, or the
// freeze point once frozen). y is points-remaining scaled against that *side's own* axis ceiling
// (see computeAxisScale) - each side gets its own independent scale so a trailing side's line still
// visibly moves instead of being squashed flat by a leading side's much larger numbers. Clamped to
// at most 1: once the ceiling has stepped down in response to recent samples, an older/higher
// sample can exceed it - it simply renders pinned to the top of the chart rather than escaping the
// plot area, which is the normal, expected look for a live-rescaling axis. imperialLabel/
// devastationLabel are each that side's own last (rightmost) point, in raw remaining-value terms -
// always both present once there's at least one sample (both sides get a sample every tick).
export function computeTrackerGraphPoints(state: TrackedPlanetState): TrackerGraphPoints {
  const { samples } = state;
  if (samples.length === 0) return EMPTY_GRAPH_POINTS;

  const firstMs = samples[0].atMs;
  const lastMs = samples[samples.length - 1].atMs;
  const durationMs = lastMs - firstMs;

  function toX(atMs: number): number {
    return durationMs > 0 ? (atMs - firstMs) / durationMs : 0;
  }
  function toY(value: number, ceiling: number): number {
    return ceiling > 0 ? Math.min(1, Math.max(0, value) / ceiling) : 0;
  }

  const imperialAxis = computeAxisScale(samples.map((s) => s.imperialRemaining));
  const devastationAxis = computeAxisScale(samples.map((s) => s.devastationRemaining));

  const imperial = samples.map((s) => ({ x: toX(s.atMs), y: toY(s.imperialRemaining, imperialAxis.ceiling) }));
  const devastation = samples.map((s) => ({ x: toX(s.atMs), y: toY(s.devastationRemaining, devastationAxis.ceiling) }));

  const last = samples[samples.length - 1];
  const imperialLabel: LabeledPoint = { x: imperial[imperial.length - 1].x, y: imperial[imperial.length - 1].y, value: last.imperialRemaining };
  const devastationLabel: LabeledPoint = { x: devastation[devastation.length - 1].x, y: devastation[devastation.length - 1].y, value: last.devastationRemaining };

  return { imperial, devastation, imperialAxis, devastationAxis, timeTicks: computeTimeTicks(samples), imperialLabel, devastationLabel };
}

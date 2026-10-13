import type { CrusadePlanet } from "../api/types";
import { isPlanetTrackable } from "./tracked-planet";
import { computeConquestProgress, pointsRemaining } from "./crusade-domination-view-model";

export interface TrackedPlanetSample {
  atMs: number;
  imperialRemaining: number;
  devastationRemaining: number;
  // Raw accrued points and raw capture threshold at this moment, recorded alongside the legacy
  // *Remaining fields above (not instead of them) starting 2026-10-13 - optional because older
  // already-stored samples won't have them. imperialRemaining/devastationRemaining are threshold
  // minus current, which silently conflates "the attacker lost ground" with "the defender raised
  // the threshold" (a planetary-defenses powerup can do that even while fully uncontested) - these
  // four let callers that need an honest rate-of-change (computeHourlyAccruedRate) or an honest
  // historical remaining value (resolveRemaining) tell the two apart.
  // TODO(2026-10-20): the current Domination season ends 2026-10-17 - once that's passed, every
  // live era's history will have been recorded entirely after this change, so these can become
  // required (drop the "?") and imperialRemaining/devastationRemaining/resolveRemaining's fallback
  // can be deleted outright.
  imperialAccrued?: number;
  devastationAccrued?: number;
  imperialThreshold?: number;
  devastationThreshold?: number;
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
  const progress = computeConquestProgress(planet);
  // TODO(2026-10-20): stop writing imperialRemaining/devastationRemaining once the season ending
  // 2026-10-17 is over - see TrackedPlanetSample's own comment.
  const sample: TrackedPlanetSample = {
    atMs: nowMs,
    imperialRemaining: remaining.imperial,
    devastationRemaining: remaining.devastation,
    imperialAccrued: progress?.imperialCurrent,
    devastationAccrued: progress?.devastationCurrent,
    imperialThreshold: progress?.imperialThreshold,
    devastationThreshold: progress?.devastationThreshold,
  };
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

// Prepends server-recorded history (see src/api/fetch-planet-history.ts) onto a just-created
// tracked state, so the graph shows everything recorded since the current capture cycle began
// instead of starting empty from the moment the user clicked track. `history` is always strictly
// earlier than any live sample by construction (fetched once, synchronously before the live loop's
// first append can land), so this is a plain prepend, never a sort. Re-derives `frozen` from the
// merged array's last sample (appendTrackedSample's own freeze condition) to cover the edge case
// where the fetched history already shows the planet captured moments before tracking started. A
// no-op for an empty history (nothing recorded yet for this era, or the fetch failed/timed out).
export function mergeHistoryIntoTrackedPlanetState(state: TrackedPlanetState, history: readonly TrackedPlanetSample[]): TrackedPlanetState {
  if (history.length === 0) return state;
  const samples = [...history, ...state.samples];
  const last = samples[samples.length - 1];
  const frozen = state.frozen || last.imperialRemaining <= 0 || last.devastationRemaining <= 0;
  return { ...state, samples, startedAtMs: samples[0].atMs, frozen };
}

// Builds a read-only TrackedPlanetState purely from persisted history (see
// src/api/fetch-planet-history.ts's fetchAllPlanetHistory) - used by the Monitor tab to show every
// planet's graph without actively tracking (polling) any of them. frozen mirrors
// appendTrackedSample's own freeze condition, derived from the last sample rather than live data.
// An empty history (nothing recorded yet) is a valid, un-frozen, zero-sample state - the graph
// component already renders that as an empty plot rather than erroring.
export function trackedStateFromHistory(planetId: string, history: readonly TrackedPlanetSample[], nowMs: number): TrackedPlanetState {
  const last = history[history.length - 1];
  const frozen = last ? last.imperialRemaining <= 0 || last.devastationRemaining <= 0 : false;
  return { planetId, startedAtMs: history[0]?.atMs ?? nowMs, samples: [...history], frozen };
}

// A single "right now" sample straight from the planet's own current live data (not persisted
// history) - used by the Monitor tab as a fallback for a planet with no recorded history yet
// (just recontested, or the backend poller simply hasn't caught up since this feature shipped) so
// it still shows *something* instead of a perpetually empty graph until the next poller tick.
// Returns null when the planet has no struggleData - pointsRemaining is Infinity in that case,
// which can't scale an axis and isn't meaningful to plot anyway.
export function liveSnapshotSample(planet: CrusadePlanet, nowMs: number): TrackedPlanetSample | null {
  const remaining = pointsRemaining(planet);
  if (!Number.isFinite(remaining.imperial) || !Number.isFinite(remaining.devastation)) return null;
  const progress = computeConquestProgress(planet);
  return {
    atMs: nowMs,
    imperialRemaining: remaining.imperial,
    devastationRemaining: remaining.devastation,
    imperialAccrued: progress?.imperialCurrent,
    devastationAccrued: progress?.devastationCurrent,
    imperialThreshold: progress?.imperialThreshold,
    devastationThreshold: progress?.devastationThreshold,
  };
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

// One drawable line: its points (already normalized against whichever axis it's paired with) plus
// its own rightmost-point label (raw remaining-value terms) - always present once there's at least
// one sample, unlike the single XOR-picked label this used to be. Which line renders its label
// above/below its point (so two labels sharing one graph don't overlap) is a rendering decision made
// in the .tsx component, which has the shared pixel mapping needed to compare screen positions.
export interface GraphLine {
  points: GraphPoint[];
  // Raw remaining-value per sample, same order/length as `points` - lets the hover tooltip show
  // the exact points-remaining number at any sample, not just the rightmost (label's) one.
  values: number[];
  label: LabeledPoint | null;
}

export interface SingleSideGraph {
  line: GraphLine;
  axis: SideAxis;
}

// Both sides' lines, each normalized against the *same* one shared axis - see
// computeTrackerGraphData's own comment for why this exists alongside the independent-scale graphs.
export interface CombinedGraph {
  imperial: GraphLine;
  devastation: GraphLine;
  axis: SideAxis;
}

export interface TrackerGraphData {
  imperial: SingleSideGraph;
  devastation: SingleSideGraph;
  combined: CombinedGraph;
  timeTicks: TimeTick[];
  // Elapsed seconds since the first sample, one per sample, same order as every line's `values` -
  // every line on a given planet shares this same x-axis, so it's computed once here rather than
  // duplicated per line. Lets the hover tooltip show *when* a point was sampled, not just its value.
  sampleElapsedSeconds: number[];
}

const EMPTY_AXIS: SideAxis = { ceiling: 0, ticks: [] };
const EMPTY_LINE: GraphLine = { points: [], values: [], label: null };
const EMPTY_GRAPH_DATA: TrackerGraphData = {
  imperial: { line: EMPTY_LINE, axis: EMPTY_AXIS },
  devastation: { line: EMPTY_LINE, axis: EMPTY_AXIS },
  combined: { imperial: EMPTY_LINE, devastation: EMPTY_LINE, axis: EMPTY_AXIS },
  timeTicks: [],
  sampleElapsedSeconds: [],
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

// The ceiling is simply the highest value this side has ever reached this session (rounded up to
// its own clean single-digit-times-a-power-of-ten value, see rawCeiling) - it only ever grows,
// never shrinks. An earlier attempt at a dynamically-shrinking axis (stepping down over time as the
// value dropped) looked bad in practice, so the axis is deliberately static once a peak is set - a
// sample of exactly 0 (that side already fully captured/depleted) is skipped entirely so it can't
// drag a still-live axis down to nothing.
function computeCeiling(values: readonly number[]): number {
  let ceiling = MIN_CEILING;
  for (const v of values) {
    if (v <= 0) continue;
    const raw = rawCeiling(v);
    if (raw > ceiling) ceiling = raw;
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

// One side's independent scale: a ceiling that's the highest value this side has ever reached
// (see computeCeiling - it never shrinks), plus one grid-line tick per single-digit multiple of the
// ceiling's own decade up to the ceiling itself - always clean single-significant-digit values by
// construction, so no separate rounding step is needed for the tick values (only for arbitrary/
// unrounded numbers, which don't occur here).
export function computeAxisScale(values: readonly number[]): SideAxis {
  const ceiling = computeCeiling(values);
  const decade = decadeOf(ceiling);
  const k = Math.round(ceiling / decade);
  const ticks: AxisTick[] = [];
  for (let n = 1; n <= k; n++) {
    const value = n * decade;
    ticks.push({ value, normalizedY: value / ceiling, label: formatAxisValue(value) });
  }
  return { ceiling, ticks };
}

// ss under a minute, mm:ss under an hour, HH:mm:ss from an hour on - shared by the time axis's tick
// labels, the "Ns/Captured at Ns" caption, and the hover tooltip, so every elapsed-time display on
// a tracker graph ticks over to the next format at exactly the same point.
export function formatElapsedSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
// exactly reaching) the given duration - unlike the value axes, elapsed time isn't logarithmic, so
// no significant-digit rounding applies here, just a compact "Ns" / "M:SS" format. No ticks for a
// non-positive duration (no time range to divide) - the natural (non-windowed) case this means
// fewer than two samples exist yet, since firstMs === lastMs with only one.
function computeTimeTicks(durationMs: number): TimeTick[] {
  if (durationMs <= 0) return [];
  const durationSeconds = durationMs / 1000;
  const step = timeAxisStepSeconds(durationSeconds);
  const ticks: TimeTick[] = [];
  for (let s = 0; s <= durationSeconds; s += step) {
    ticks.push({ normalizedX: s / durationSeconds, label: formatElapsedSeconds(Math.round(s)) });
  }
  return ticks;
}

// Computes all three graphs' worth of data in one pass: independent-scale Imperial and
// Devastation lines (each side's own peak-only-grows ceiling, see computeCeiling - unchanged, a
// trailing side's line still visibly moves instead of being squashed flat by a leading side's much
// larger numbers), plus a Combined line pair that shares *one* axis (the larger of the two sides'
// own ceilings, via concatenating both sides' values into one computeAxisScale call) so relative
// progress between the two sides is always honestly comparable there - the two views are
// deliberately kept side by side rather than trying to auto-pick one, since dynamically switching
// between them would reintroduce the same kind of rescale-driven jumpiness that was just removed.
// x is elapsed time since the first sample (0 = first sample, 1 = the last sample - i.e. "now" while
// live, or the freeze point once frozen), shared by all three graphs. y-clamping to at most 1 is a
// defensive belt-and-braces guard against floating-point edge cases (ceilings only grow, so normal
// data should never actually hit it).
// Prefers the honest threshold-minus-accrued value over the legacy stored *Remaining field,
// falling back to the legacy field only when either new field is missing on this particular sample
// (an older sample recorded before 2026-10-13). Used only for graph display - the rate calculation
// below always wants raw accrued, never a derived remaining value.
// TODO(2026-10-20): delete this fallback and read imperialThreshold - imperialAccrued (same for
// devastation) unconditionally, once the season ending 2026-10-17 is over.
function resolveRemaining(sample: TrackedPlanetSample, side: "imperial" | "devastation"): number {
  const accrued = side === "imperial" ? sample.imperialAccrued : sample.devastationAccrued;
  const threshold = side === "imperial" ? sample.imperialThreshold : sample.devastationThreshold;
  if (accrued !== undefined && threshold !== undefined) return threshold - accrued;
  return side === "imperial" ? sample.imperialRemaining : sample.devastationRemaining;
}

export interface GraphTimeWindow {
  startMs: number;
  endMs: number;
}

// Optional `window` clamps the x-axis to exactly [startMs, endMs] (e.g. "now - N hours" to "now"),
// regardless of where the actual samples fall within it - without this, the axis was derived from
// the samples' own min/max timestamps, which silently fell short of the requested window whenever
// the nearest real sample didn't land exactly on the boundary (poll cadence, thinned-out older
// samples, or simply a stale "now" argument) - "last N hours" should mean exactly that, not
// "whatever span the surviving samples happen to cover." Samples outside the window are dropped
// from the lines/axis-scale entirely (never just visually clipped), so a mostly-empty window still
// renders truthfully (a short line against a full N-hour-wide, mostly blank plot) rather than
// stretching sparse data to fill the space. No window (the default) preserves the natural,
// sample-derived bounds this had before windowing existed.
export function computeTrackerGraphData(state: TrackedPlanetState, window?: GraphTimeWindow): TrackerGraphData {
  const { samples: allSamples } = state;
  if (allSamples.length === 0) return EMPTY_GRAPH_DATA;

  const samples = window ? allSamples.filter((s) => s.atMs >= window.startMs && s.atMs <= window.endMs) : allSamples;
  const firstMs = window ? window.startMs : samples[0].atMs;
  const lastMs = window ? window.endMs : samples[samples.length - 1].atMs;
  const durationMs = lastMs - firstMs;

  function toX(atMs: number): number {
    return durationMs > 0 ? (atMs - firstMs) / durationMs : 0;
  }
  function toY(value: number, ceiling: number): number {
    return ceiling > 0 ? Math.min(1, Math.max(0, value) / ceiling) : 0;
  }

  const xs = samples.map((s) => toX(s.atMs));
  const imperialValues = samples.map((s) => resolveRemaining(s, "imperial"));
  const devastationValues = samples.map((s) => resolveRemaining(s, "devastation"));

  function buildLine(values: readonly number[], ceiling: number): GraphLine {
    const points = values.map((v, i) => ({ x: xs[i], y: toY(v, ceiling) }));
    const last = points.length > 0 ? points[points.length - 1] : null;
    return {
      points,
      values: [...values],
      label: last ? { x: last.x, y: last.y, value: values[values.length - 1] } : null,
    };
  }

  const imperialAxis = computeAxisScale(imperialValues);
  const devastationAxis = computeAxisScale(devastationValues);
  const combinedAxis = computeAxisScale([...imperialValues, ...devastationValues]);

  return {
    imperial: { line: buildLine(imperialValues, imperialAxis.ceiling), axis: imperialAxis },
    devastation: { line: buildLine(devastationValues, devastationAxis.ceiling), axis: devastationAxis },
    combined: {
      imperial: buildLine(imperialValues, combinedAxis.ceiling),
      devastation: buildLine(devastationValues, combinedAxis.ceiling),
      axis: combinedAxis,
    },
    timeTicks: computeTimeTicks(durationMs),
    sampleElapsedSeconds: samples.map((s) => Math.round((s.atMs - firstMs) / 1000)),
  };
}

export interface TimedValue {
  atMs: number;
  value: number;
}

// Linear-interpolates the value at `atMs` from two bracketing samples (`samples` must be sorted
// ascending by atMs, oldest first - every caller in this codebase already stores samples that way).
// Null when `atMs` falls before the first sample (no data reaches that far back) or the array is
// empty - the caller treats that as "use the fallback path" rather than a crash.
function interpolateValueAt(samples: readonly TimedValue[], atMs: number): number | null {
  if (samples.length === 0 || atMs < samples[0].atMs) return null;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].atMs >= atMs) {
      const a = samples[i - 1];
      const b = samples[i];
      if (b.atMs === a.atMs) return a.value;
      const t = (atMs - a.atMs) / (b.atMs - a.atMs);
      return a.value + (b.value - a.value) * t;
    }
  }
  // atMs is at or after the last sample - nothing to interpolate between, just use the latest value.
  return samples[samples.length - 1].value;
}

const MS_PER_HOUR = 60 * 60 * 1000;

// Points/hour for one side, from its accrued-points history (NOT points-remaining - see
// TrackedPlanetSample's own comment on why remaining can't be diffed reliably across time).
// `samples` is the full, untrimmed accrued-points history for this side, oldest first.
// `currentValue` is that side's LIVE accrued points right now (always fresher than the last stored
// sample). Primary path: interpolate the value exactly one hour ago and diff against currentValue -
// expected to be the common case, since the poller samples roughly every 5 minutes. Fallback (less
// than an hour of history available): the rate since the earliest known sample, scaled up to a
// per-hour figure via (60 / elapsedMinutes).
export function computeHourlyAccruedRate(samples: readonly TimedValue[], currentValue: number, nowMs: number): number {
  if (samples.length === 0) return 0;
  const oneHourAgo = nowMs - MS_PER_HOUR;
  const valueOneHourAgo = interpolateValueAt(samples, oneHourAgo);
  if (valueOneHourAgo !== null) return currentValue - valueOneHourAgo;

  const startedAtMs = samples[0].atMs;
  const elapsedMinutes = (nowMs - startedAtMs) / 60_000;
  if (elapsedMinutes <= 0) return 0;
  const sinceStart = currentValue - samples[0].value;
  return sinceStart * (60 / elapsedMinutes);
}

export type CaptureUrgency = "imminent" | "withinTwoHours" | "withinFourHours" | "normal";

// How soon, at the current hourly rate, a side would cross its own capture threshold - drives the
// points-rate indicator's color (see PointsRateIndicator.tsx). A non-positive rate (not gaining, or
// actively losing ground) or an already-captured planet (pointsRemaining <= 0) is always "normal" -
// there's no meaningful "time until capture" to project in either case.
export function captureUrgency(pointsRemainingNow: number, hourlyRate: number): CaptureUrgency {
  if (hourlyRate <= 0 || pointsRemainingNow <= 0) return "normal";
  const hoursUntilCapture = pointsRemainingNow / hourlyRate;
  if (hoursUntilCapture <= 1) return "imminent";
  if (hoursUntilCapture <= 2) return "withinTwoHours";
  if (hoursUntilCapture <= 4) return "withinFourHours";
  return "normal";
}

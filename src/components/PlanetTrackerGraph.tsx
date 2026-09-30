import { computeTrackerGraphPoints, type TrackedPlanetState } from "../crusade/planet-tracker-view-model";

// Same side colors as the sector map modal's NODE_COLOR (not shared/exported anywhere in this
// codebase - every hand-rolled SVG component defines its own local copy).
const IMPERIAL_COLOR = "#2563eb";
const DEVASTATION_COLOR = "#dc2626";

// Fixed size, no scaling - 1 viewBox unit is exactly 1 real pixel, so strokeWidth/fontSize below are
// literal on-screen pixel values, not something that stretches with the container.
const VIEWBOX_WIDTH = 500;
const VIEWBOX_HEIGHT = 300;
// Left/right margins hold each side's own axis labels (Imperial left, Devastation right - see the
// dual-axis rendering below); bottom holds the time-axis labels; top is just breathing room.
const MARGIN_LEFT = 44;
const MARGIN_RIGHT = 44;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 26;
const PLOT_WIDTH = VIEWBOX_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const PLOT_HEIGHT = VIEWBOX_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
const PLOT_LEFT = MARGIN_LEFT;
const PLOT_RIGHT = VIEWBOX_WIDTH - MARGIN_RIGHT;
const PLOT_BOTTOM = VIEWBOX_HEIGHT - MARGIN_BOTTOM;

function toSvgX(normalizedX: number): number {
  return PLOT_LEFT + normalizedX * PLOT_WIDTH;
}
// y=1 (a side's own axis ceiling) plots at the top; y=0 (captured) plots at the bottom - "points
// left for capture" reads as a countdown toward the x-axis. Both sides share this same pixel
// mapping - it's their *input* y (already normalized against each side's own ceiling in
// computeTrackerGraphPoints) that differs, not this function.
function toSvgY(normalizedY: number): number {
  return MARGIN_TOP + (1 - normalizedY) * PLOT_HEIGHT;
}

function toPolylinePoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(" ");
}

// Both lines are always labeled at their rightmost point now (not just whichever's closer to zero,
// since the two sides no longer share one scale for "closer" to mean anything). `above` decides
// which side of the point the text sits on - the caller compares the two points' actual pixel y so
// whichever is drawn higher on screen gets its label above, and the other gets its label below,
// keeping the two callouts from overlapping regardless of how the two independent axes happen to
// place them.
function LabelCallout({ x, y, value, color, above }: { x: number; y: number; value: number; color: string; above: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={3.2} fill={color} />
      <text x={x} y={above ? y - 8 : y + 16} textAnchor="end" fontSize={13} fontWeight="bold" fill={color}>
        {value.toLocaleString()} remaining
      </text>
    </g>
  );
}

interface PlanetTrackerGraphProps {
  state: TrackedPlanetState;
  planetName: string;
  // Drives only the "elapsed" caption while live - the line/point positions come entirely from the
  // samples themselves (see computeTrackerGraphPoints), so a stale nowMs never misdraws the lines,
  // it just freezes the caption along with everything else once the parent stops re-passing it.
  nowMs: number;
}

export function PlanetTrackerGraph({ state, planetName, nowMs }: PlanetTrackerGraphProps) {
  const { imperial, devastation, imperialAxis, devastationAxis, timeTicks, imperialLabel, devastationLabel } = computeTrackerGraphPoints(state);
  const elapsedSeconds = Math.max(0, Math.round(((state.frozen ? state.samples[state.samples.length - 1]?.atMs ?? nowMs : nowMs) - state.startedAtMs) / 1000));

  return (
    <div className="mt-4 w-full rounded-lg border border-black/10 bg-white/60 p-3 dark:border-white/15 dark:bg-white/5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-medium">Tracking {planetName}</h3>
        <span className="text-xs opacity-70">{state.frozen ? `Captured at ${elapsedSeconds}s` : `${elapsedSeconds}s elapsed`}</span>
      </div>
      {/* Fixed 500x300 - deliberately not scaled to the container in either dimension (no w-full/
          h-full, no preserveAspectRatio trickery). 1 viewBox unit = 1 real pixel throughout. */}
      <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT}>
        {/* Imperial (left) horizontal grid lines + labels - each side's grid is independent, drawn
            at that side's own ceiling-relative position, so the two sets of lines generally land at
            different heights. */}
        {imperialAxis.ticks.map((tick) => {
          const y = toSvgY(tick.normalizedY);
          return (
            <g key={`imperial-${tick.value}`}>
              <line x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} stroke={IMPERIAL_COLOR} strokeOpacity={0.15} strokeWidth={1} />
              <text x={PLOT_LEFT - 5} y={y + 3.5} textAnchor="end" fontSize={11} fill={IMPERIAL_COLOR}>
                {tick.label}
              </text>
            </g>
          );
        })}
        {/* Devastation (right) horizontal grid lines + labels. */}
        {devastationAxis.ticks.map((tick) => {
          const y = toSvgY(tick.normalizedY);
          return (
            <g key={`devastation-${tick.value}`}>
              <line x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} stroke={DEVASTATION_COLOR} strokeOpacity={0.15} strokeWidth={1} />
              <text x={PLOT_RIGHT + 5} y={y + 3.5} textAnchor="start" fontSize={11} fill={DEVASTATION_COLOR}>
                {tick.label}
              </text>
            </g>
          );
        })}
        {/* Vertical (time) grid lines + labels. */}
        {timeTicks.map((tick) => {
          const x = toSvgX(tick.normalizedX);
          const textAnchor = tick.normalizedX === 0 ? "start" : tick.normalizedX === 1 ? "end" : "middle";
          return (
            <g key={tick.normalizedX}>
              <line x1={x} y1={MARGIN_TOP} x2={x} y2={PLOT_BOTTOM} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
              <text x={x} y={PLOT_BOTTOM + 15} textAnchor={textAnchor} fontSize={11} fill="currentColor" opacity={0.6}>
                {tick.label}
              </text>
            </g>
          );
        })}
        {/* 0-points-remaining baseline - more solid than the tick grid lines above, since every
            side's axis shares this same bottom edge. */}
        <line x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
        {imperial.length > 1 && <polyline points={toPolylinePoints(imperial)} fill="none" stroke={IMPERIAL_COLOR} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
        {devastation.length > 1 && (
          <polyline points={toPolylinePoints(devastation)} fill="none" stroke={DEVASTATION_COLOR} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {imperial.length === 1 && <circle cx={toSvgX(imperial[0].x)} cy={toSvgY(imperial[0].y)} r={3} fill={IMPERIAL_COLOR} />}
        {devastation.length === 1 && <circle cx={toSvgX(devastation[0].x)} cy={toSvgY(devastation[0].y)} r={3} fill={DEVASTATION_COLOR} />}
        {imperialLabel && devastationLabel && (
          <>
            <LabelCallout
              x={toSvgX(imperialLabel.x)}
              y={toSvgY(imperialLabel.y)}
              value={imperialLabel.value}
              color={IMPERIAL_COLOR}
              above={toSvgY(imperialLabel.y) <= toSvgY(devastationLabel.y)}
            />
            <LabelCallout
              x={toSvgX(devastationLabel.x)}
              y={toSvgY(devastationLabel.y)}
              value={devastationLabel.value}
              color={DEVASTATION_COLOR}
              above={toSvgY(devastationLabel.y) < toSvgY(imperialLabel.y)}
            />
          </>
        )}
      </svg>
    </div>
  );
}

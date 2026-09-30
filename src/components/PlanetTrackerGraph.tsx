import type { ReactNode } from "react";
import { computeTrackerGraphData, type GraphPoint, type LabeledPoint, type SideAxis, type TimeTick, type TrackedPlanetState } from "../crusade/planet-tracker-view-model";

// Same side colors as the sector map modal's NODE_COLOR (not shared/exported anywhere in this
// codebase - every hand-rolled SVG component defines its own local copy).
const IMPERIAL_COLOR = "#2563eb";
const DEVASTATION_COLOR = "#dc2626";

// Fixed size, no scaling - 1 viewBox unit is exactly 1 real pixel, so strokeWidth/fontSize below are
// literal on-screen pixel values, not something that stretches with the container. Same size for
// all three graphs (Imperial/Devastation/Combined) - shrinking them to fit more per row is a
// possible follow-up if this proves too wide on common desktop windows, but not done unprompted
// since the exact fixed size was itself a recent, deliberate choice.
const VIEWBOX_WIDTH = 500;
const VIEWBOX_HEIGHT = 300;
// Left/right margins hold axis labels (a solo graph only ever uses the left one; Combined uses
// both - Imperial left, Devastation right); bottom holds the time-axis labels; top is breathing room.
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
// y=1 (an axis's own ceiling) plots at the top; y=0 (captured) plots at the bottom - "points left
// for capture" reads as a countdown toward the x-axis. Every line/axis on a graph shares this same
// pixel mapping - it's their *input* y (already normalized against whichever axis they're paired
// with in the view-model) that can differ, not this function.
function toSvgY(normalizedY: number): number {
  return MARGIN_TOP + (1 - normalizedY) * PLOT_HEIGHT;
}

function toPolylinePoints(points: readonly GraphPoint[]): string {
  return points.map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(" ");
}

// A line's rightmost point is always labeled. `above` decides which side of the point the text
// sits on - the caller compares pixel y across every line sharing this graph so whichever is drawn
// higher on screen gets its label above, and the other(s) get theirs below, keeping labels from
// overlapping regardless of how their axis/axes happen to place them. A solo graph (only one line)
// has nothing to avoid overlapping with, so it always renders above.
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

interface AxisSpec {
  axis: SideAxis;
  side: "left" | "right";
  color: string;
}

interface LineSpec {
  points: GraphPoint[];
  label: LabeledPoint | null;
  color: string;
}

// The shared rendering core for all three graphs - a solo graph passes one AxisSpec/LineSpec, the
// Combined graph passes two (both AxisSpecs pointing at the very same SideAxis, one per side, so
// the same numbers are drawn once at the left edge and once at the right).
function SingleGraph({ axes, lines, timeTicks }: { axes: AxisSpec[]; lines: LineSpec[]; timeTicks: TimeTick[] }) {
  return (
    <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT}>
      {axes.map(({ axis, side, color }) =>
        axis.ticks.map((tick) => {
          const y = toSvgY(tick.normalizedY);
          return (
            <g key={`${side}-${tick.value}`}>
              <line x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} stroke={color} strokeOpacity={0.15} strokeWidth={1} />
              <text x={side === "left" ? PLOT_LEFT - 5 : PLOT_RIGHT + 5} y={y + 3.5} textAnchor={side === "left" ? "end" : "start"} fontSize={11} fill={color}>
                {tick.label}
              </text>
            </g>
          );
        }),
      )}
      {/* Vertical (time) grid lines + labels - shared by every graph on this planet. */}
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
          axis on this graph shares this same bottom edge. */}
      <line x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
      {lines.map(
        ({ points, color }, i) =>
          points.length > 1 && <polyline key={i} points={toPolylinePoints(points)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />,
      )}
      {lines.map(({ points, color }, i) => points.length === 1 && <circle key={i} cx={toSvgX(points[0].x)} cy={toSvgY(points[0].y)} r={3} fill={color} />)}
      {lines.map(({ label, color }, i) => {
        if (!label) return null;
        const thisY = toSvgY(label.y);
        // Above unless some *other* line's label sits at or above this one on screen (solo graphs
        // have no other line to compare against, so they always land in the `every` vacuous-true
        // case and render above).
        const above = lines.every((other, j) => j === i || !other.label || thisY <= toSvgY(other.label.y));
        return <LabelCallout key={i} x={toSvgX(label.x)} y={thisY} value={label.value} color={color} above={above} />;
      })}
    </svg>
  );
}

function GraphCard({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <div className="w-fit rounded-lg border border-black/10 bg-white/60 p-3 dark:border-white/15 dark:bg-white/5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs opacity-70">{caption}</span>
      </div>
      {children}
    </div>
  );
}

interface PlanetTrackerGraphProps {
  state: TrackedPlanetState;
  planetName: string;
  // Drives only the "elapsed" caption while live - the line/point positions come entirely from the
  // samples themselves (see computeTrackerGraphData), so a stale nowMs never misdraws the lines, it
  // just freezes the caption along with everything else once the parent stops re-passing it.
  nowMs: number;
}

export function PlanetTrackerGraph({ state, planetName, nowMs }: PlanetTrackerGraphProps) {
  const data = computeTrackerGraphData(state);
  const elapsedSeconds = Math.max(0, Math.round(((state.frozen ? state.samples[state.samples.length - 1]?.atMs ?? nowMs : nowMs) - state.startedAtMs) / 1000));
  const caption = state.frozen ? `Captured at ${elapsedSeconds}s` : `${elapsedSeconds}s elapsed`;

  return (
    <div className="mt-4 flex flex-wrap gap-4">
      <GraphCard title={`${planetName} - Imperial`} caption={caption}>
        <SingleGraph
          axes={[{ axis: data.imperial.axis, side: "left", color: IMPERIAL_COLOR }]}
          lines={[{ points: data.imperial.line.points, label: data.imperial.line.label, color: IMPERIAL_COLOR }]}
          timeTicks={data.timeTicks}
        />
      </GraphCard>
      <GraphCard title={`${planetName} - Devastation`} caption={caption}>
        <SingleGraph
          axes={[{ axis: data.devastation.axis, side: "left", color: DEVASTATION_COLOR }]}
          lines={[{ points: data.devastation.line.points, label: data.devastation.line.label, color: DEVASTATION_COLOR }]}
          timeTicks={data.timeTicks}
        />
      </GraphCard>
      <GraphCard title={`${planetName} - Combined`} caption={caption}>
        <SingleGraph
          axes={[
            { axis: data.combined.axis, side: "left", color: IMPERIAL_COLOR },
            { axis: data.combined.axis, side: "right", color: DEVASTATION_COLOR },
          ]}
          lines={[
            { points: data.combined.imperial.points, label: data.combined.imperial.label, color: IMPERIAL_COLOR },
            { points: data.combined.devastation.points, label: data.combined.devastation.label, color: DEVASTATION_COLOR },
          ]}
          timeTicks={data.timeTicks}
        />
      </GraphCard>
    </div>
  );
}

import { useEffect, useState, type CSSProperties } from "react";
import { Modal } from "./Modal";
import { dotRadius, MAX_DOT_RADIUS, planetProgressBars, type SectorMapColor, type SectorMapData } from "../crusade/crusade-sector-map-view-model";

// Imperial/Devastation match the codebase's established side-color intent from the map's own
// legend; the highlight ring reuses this codebase's existing "complete/target" green
// (OpsCardFrame.tsx/OperationsTable.tsx use green-700/green-500 the same way).
const NODE_COLOR: Record<SectorMapColor, string> = {
  imperial: "#2563eb",
  devastation: "#dc2626",
  neutral: "#9ca3af",
};
const HIGHLIGHT_COLOR = "#15803d";
// Darker shades of the same two colors, for the progress arc's outline (blue-900/red-900 vs. the
// blue-600/red-600 fill above).
const ARC_OUTLINE_COLOR: Record<"imperial" | "devastation", string> = {
  imperial: "#1e3a8a",
  devastation: "#7f1d1d",
};

// A small inset so planets sitting right at a sector's edge (normalized 0 or 1) don't get their
// circle, the progress bars above it, or the name below it clipped by the viewBox.
const MARGIN = 14;
const VIEWBOX_SIZE = 100;
const SPAN = VIEWBOX_SIZE - MARGIN * 2;
function toSvg(normalized: number): number {
  return MARGIN + normalized * SPAN;
}

// Geometry in viewBox units, relative to a planet's center: the name sits below the highlight
// ring (radius 4); the progress arcs (below) hug the dot itself instead of sitting above it.
const NAME_BASELINE = 6.5;
const TRACK_COLOR = "#9ca3af";
// How far outside the dot's own radius the arc sits - just enough that it reads as a ring around
// the planet rather than overlapping its fill.
const ARC_GAP = 0.7;
const ARC_STROKE_WIDTH = 0.8;
// The filled bar's outline is drawn as a wider, darker copy of the same path directly behind it -
// there's no SVG "stroke around a stroke", so this peeking out on both sides is what reads as a
// border. The track (unfilled portion) doesn't get one, only the colored fill.
const ARC_OUTLINE_STROKE_WIDTH = ARC_STROKE_WIDTH + 0.4;

// One side's half-circle arc, hugging the dot at radius r: `fraction` 1 traces the full track
// from the top pole to the bottom pole (12 o'clock down to 6 o'clock); less than 1 traces only
// the bottom portion of it, so progress reads as filling the ring from the bottom up, like a
// gauge. "left"/"right" pick which half (Imperial hugs the left, Devastation the right).
function sideArcPath(cx: number, cy: number, r: number, side: "left" | "right", fraction: number): string {
  const sign = side === "left" ? -1 : 1;
  const sweepFlag = side === "left" ? 0 : 1;
  const theta = Math.PI * (1 - fraction); // 0 (top pole) when fraction=1, up to PI (bottom pole) when fraction=0
  const startX = cx + sign * r * Math.sin(theta);
  const startY = cy - r * Math.cos(theta);
  return `M ${startX} ${startY} A ${r} ${r} 0 0 ${sweepFlag} ${cx} ${cy + r}`;
}

// The faint full track plus its filled portion, both hugging one side of the planet's dot -
// rendered as part of the same per-node <g> as the dot itself, so it draws over the graph's
// connection lines (rendered earlier in the SVG) the same way the dot already does.
function SideArc({
  cx,
  cy,
  r,
  side,
  fraction,
  color,
  outlineColor,
  label,
}: {
  cx: number;
  cy: number;
  r: number;
  side: "left" | "right";
  fraction: number;
  color: string;
  outlineColor: string;
  label: string;
}) {
  const fillPath = sideArcPath(cx, cy, r, side, fraction);
  return (
    <g>
      {/* butt (not round) caps - a rounded cap draws a little semicircular bump past the actual
          endpoint, which reads as a soft/fuzzy edge instead of a clean cut where the fill stops. */}
      <path d={sideArcPath(cx, cy, r, side, 1)} fill="none" stroke={TRACK_COLOR} strokeOpacity={0.35} strokeWidth={ARC_STROKE_WIDTH} strokeLinecap="butt" />
      {fraction > 0 && (
        <>
          <path d={fillPath} fill="none" stroke={outlineColor} strokeWidth={ARC_OUTLINE_STROKE_WIDTH} strokeLinecap="butt" />
          <path d={fillPath} fill="none" stroke={color} strokeWidth={ARC_STROKE_WIDTH} strokeLinecap="butt" />
        </>
      )}
      <title>{label}</title>
    </g>
  );
}

const ARROW_BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full text-2xl leading-none text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white";

function SectorSvg({ sectorMapData, highlightPlanetId, className, style }: { sectorMapData: SectorMapData; highlightPlanetId: string; className: string; style?: CSSProperties }) {
  return (
    <svg viewBox={`0 0 ${VIEWBOX_SIZE + (sectorMapData.aspect - 1) * SPAN} ${VIEWBOX_SIZE}`} className={className} style={style}>
      <defs>
        {sectorMapData.edges.map((edge, i) => (
          <linearGradient
            key={i}
            id={`sector-map-edge-${i}`}
            x1={toSvg(edge.from.x)}
            y1={toSvg(edge.from.y)}
            x2={toSvg(edge.to.x)}
            y2={toSvg(edge.to.y)}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={NODE_COLOR[edge.from.color]} />
            <stop offset="100%" stopColor={NODE_COLOR[edge.to.color]} />
          </linearGradient>
        ))}
      </defs>
      {sectorMapData.edges.map((edge, i) => (
        <line
          key={i}
          x1={toSvg(edge.from.x)}
          y1={toSvg(edge.from.y)}
          x2={toSvg(edge.to.x)}
          y2={toSvg(edge.to.y)}
          stroke={`url(#sector-map-edge-${i})`}
          strokeWidth={0.5}
        />
      ))}
      {sectorMapData.sectorBoundaries.map((x) => (
        <line key={x} x1={toSvg(x)} y1={0} x2={toSvg(x)} y2={VIEWBOX_SIZE} stroke="currentColor" strokeOpacity={0.4} strokeWidth={0.3} strokeDasharray="1.5 1.5" />
      ))}
      {sectorMapData.sectorLabels.map((label) => (
        <text key={label.zone} x={toSvg(label.x)} y={6} textAnchor="middle" fontSize={4} fontWeight="bold" fill="currentColor">
          Sector {label.zone + 1}
        </text>
      ))}
      {sectorMapData.nodes.map((node) => {
        const cx = toSvg(node.x);
        const cy = toSvg(node.y);
        const bars = planetProgressBars(node.progress);
        const arcRadius = dotRadius(node.dotScale) + ARC_GAP;
        return (
          <g key={node.planetId}>
            {node.planetId === highlightPlanetId && <circle cx={cx} cy={cy} r={4} fill="none" stroke={HIGHLIGHT_COLOR} strokeWidth={0.7} />}
            <circle cx={cx} cy={cy} r={dotRadius(node.dotScale)} fill={NODE_COLOR[node.color]} />
            {/* Dots can shrink to ~1px, far too small to hover - this invisible full-size target
                keeps the name tooltip reachable. */}
            <circle cx={cx} cy={cy} r={MAX_DOT_RADIUS} fill="transparent">
              <title>{node.name}</title>
            </circle>
            {bars && node.progress && (
              <>
                <SideArc
                  cx={cx}
                  cy={cy}
                  r={arcRadius}
                  side="left"
                  fraction={bars.imperial}
                  color={NODE_COLOR.imperial}
                  outlineColor={ARC_OUTLINE_COLOR.imperial}
                  label={`Imperial ${node.progress.imperialCurrent.toLocaleString()} / ${node.progress.imperialThreshold.toLocaleString()} (${Math.round(bars.imperial * 100)}%)`}
                />
                <SideArc
                  cx={cx}
                  cy={cy}
                  r={arcRadius}
                  side="right"
                  fraction={bars.devastation}
                  color={NODE_COLOR.devastation}
                  outlineColor={ARC_OUTLINE_COLOR.devastation}
                  label={`Devastation ${node.progress.devastationCurrent.toLocaleString()} / ${node.progress.devastationThreshold.toLocaleString()} (${Math.round(bars.devastation * 100)}%)`}
                />
              </>
            )}
            <text x={cx} y={cy + NAME_BASELINE} textAnchor="middle" fontSize={2.6} fill="currentColor">
              {node.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const TOGGLE_BUTTON_CLASS =
  "rounded border border-black/20 px-2 py-0.5 text-sm text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-white/20 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white";

interface PlanetSectorMapModalProps {
  sectorMapData: SectorMapData;
  // Every sector in one continuous map - what the "Expand" view draws.
  allSectorsMapData: SectorMapData;
  highlightPlanetId: string;
  onClose: () => void;
  // Steps to the previous (-1) / next (+1) sector. Omitted when there's only one sector to show,
  // which hides the arrows and leaves the arrow keys alone.
  onChangeSector?: (direction: -1 | 1) => void;
}

export function PlanetSectorMapModal({ sectorMapData, allSectorsMapData, highlightPlanetId, onClose, onChangeSector }: PlanetSectorMapModalProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!onChangeSector || expanded) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") onChangeSector!(-1);
      else if (e.key === "ArrowRight") onChangeSector!(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChangeSector, expanded]);

  const toggle = onChangeSector && (
    <button type="button" onClick={() => setExpanded(!expanded)} className={TOGGLE_BUTTON_CLASS}>
      {expanded ? "Collapse" : "Expand"}
    </button>
  );

  if (expanded) {
    return (
      <Modal onClose={onClose} wide>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">All sectors</h2>
          {toggle}
        </div>
        {/* Fixed scale (same as the single-sector view at its widest), so the map overflows the
            modal and the horizontal scrollbar does the rest. */}
        <SectorSvg
          sectorMapData={allSectorsMapData}
          highlightPlanetId={highlightPlanetId}
          className="mt-2 h-auto max-w-none shrink-0"
          style={{ width: `${(VIEWBOX_SIZE + (allSectorsMapData.aspect - 1) * SPAN) * 0.28}rem` }}
        />
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        {onChangeSector ? (
          <button type="button" aria-label="Previous sector" title="Previous sector" onClick={() => onChangeSector(-1)} className={ARROW_BUTTON_CLASS}>
            ‹
          </button>
        ) : (
          <span className="h-8 w-8" />
        )}
        <h2 className="text-lg font-semibold">Sector {sectorMapData.zone + 1}</h2>
        {onChangeSector ? (
          <button type="button" aria-label="Next sector" title="Next sector" onClick={() => onChangeSector(1)} className={ARROW_BUTTON_CLASS}>
            ›
          </button>
        ) : (
          <span className="h-8 w-8" />
        )}
      </div>
      {toggle && <div className="mt-1 flex justify-end">{toggle}</div>}
      <SectorSvg sectorMapData={sectorMapData} highlightPlanetId={highlightPlanetId} className="mt-2 h-auto w-full" />
    </Modal>
  );
}

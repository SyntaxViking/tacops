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

// A small inset so planets sitting right at a sector's edge (normalized 0 or 1) don't get their
// circle, the progress bars above it, or the name below it clipped by the viewBox.
const MARGIN = 14;
const VIEWBOX_SIZE = 100;
const SPAN = VIEWBOX_SIZE - MARGIN * 2;
function toSvg(normalized: number): number {
  return MARGIN + normalized * SPAN;
}

// Geometry in viewBox units, relative to a planet's center: the pair of bars sits above the
// highlight ring (radius 4), the name below it.
const BAR_WIDTH = 8;
const BAR_HEIGHT = 1;
const IMPERIAL_BAR_TOP = -8.2;
const DEVASTATION_BAR_TOP = -6.8;
const NAME_BASELINE = 6.5;
const TRACK_COLOR = "#9ca3af";

// A faint full-width track with the filled portion on top, so how far along it is reads at a glance.
function ProgressBar({ cx, top, fraction, color, label }: { cx: number; top: number; fraction: number; color: string; label: string }) {
  const x = cx - BAR_WIDTH / 2;
  return (
    <g>
      <rect x={x} y={top} width={BAR_WIDTH} height={BAR_HEIGHT} rx={0.3} fill={TRACK_COLOR} fillOpacity={0.35} />
      <rect x={x} y={top} width={BAR_WIDTH * fraction} height={BAR_HEIGHT} rx={0.3} fill={color} />
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
                <ProgressBar
                  cx={cx}
                  top={cy + IMPERIAL_BAR_TOP}
                  fraction={bars.imperial}
                  color={NODE_COLOR.imperial}
                  label={`Imperial ${node.progress.imperialCurrent.toLocaleString()} / ${node.progress.imperialThreshold.toLocaleString()} (${Math.round(bars.imperial * 100)}%)`}
                />
                <ProgressBar
                  cx={cx}
                  top={cy + DEVASTATION_BAR_TOP}
                  fraction={bars.devastation}
                  color={NODE_COLOR.devastation}
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

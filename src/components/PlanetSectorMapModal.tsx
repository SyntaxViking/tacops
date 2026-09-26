import { Modal } from "./Modal";
import { planetProgressBars, type SectorMapColor, type SectorMapData } from "../crusade/crusade-sector-map-view-model";

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
const SPAN = 100 - MARGIN * 2;
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

interface PlanetSectorMapModalProps {
  sectorMapData: SectorMapData;
  highlightPlanetId: string;
  onClose: () => void;
}

export function PlanetSectorMapModal({ sectorMapData, highlightPlanetId, onClose }: PlanetSectorMapModalProps) {
  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold">Sector {sectorMapData.zone + 1}</h2>
      <svg viewBox="0 0 100 100" className="mt-2 h-auto w-full">
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
        {sectorMapData.nodes.map((node) => {
          const cx = toSvg(node.x);
          const cy = toSvg(node.y);
          const bars = planetProgressBars(node.progress);
          return (
            <g key={node.planetId}>
              {node.planetId === highlightPlanetId && <circle cx={cx} cy={cy} r={4} fill="none" stroke={HIGHLIGHT_COLOR} strokeWidth={0.7} />}
              <circle cx={cx} cy={cy} r={2} fill={NODE_COLOR[node.color]}>
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
    </Modal>
  );
}

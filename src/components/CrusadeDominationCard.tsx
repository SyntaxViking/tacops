import { FactionBadge, LeaderboardBreakdownCell } from "./crusade-cells";
import { PlanetFetchTimestamp } from "./PlanetFetchTimestamp";
import { RefreshIconButton } from "./RefreshIconButton";
import { StarIconButton } from "./StarIconButton";
import { Spinner } from "./Spinner";
import { computeCaptureRace, computeConquestProgress, isPlanetRanked } from "../crusade/crusade-domination-view-model";
import type { CrusadePlanet, PlanetRefreshEntry } from "../api/types";

const labelClass = "text-xs font-medium opacity-70";

interface CrusadeDominationCardProps {
  planet: CrusadePlanet;
  refreshEntry: PlanetRefreshEntry;
  onSelectPlanet: (planetId: string) => void;
  onRefresh?: () => void;
  isFavorited: boolean;
  onToggleFavorite?: () => void;
}

export function CrusadeDominationCard({ planet, refreshEntry, onSelectPlanet, onRefresh, isFavorited, onToggleFavorite }: CrusadeDominationCardProps) {
  const leaderboard = refreshEntry.leaderboard ?? undefined;
  const progress = computeConquestProgress(planet);
  const captureRace = computeCaptureRace(planet);
  const ranked = isPlanetRanked(leaderboard);

  return (
    <div className="relative">
      {refreshEntry.isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70 dark:bg-neutral-900/70">
          <Spinner size={36} />
        </div>
      )}
      <div
        onClick={() => onSelectPlanet(planet.planetId)}
        className={`flex cursor-pointer flex-col gap-2 rounded-lg border bg-white/60 p-3 text-left dark:bg-white/5 ${
          ranked ? "border-2 border-blue-500 dark:border-blue-400" : "border-black/10 dark:border-white/15"
        } ${refreshEntry.isLoading ? "pointer-events-none" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {onToggleFavorite && <StarIconButton isFavorited={isFavorited} onToggle={onToggleFavorite} />}
            <span className="font-medium">{planet.name}</span>
          </div>
          {planet.ownedByFaction && <FactionBadge factionId={planet.ownedByFaction} />}
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs opacity-70">Sector {(planet.zone ?? 0) + 1}</span>
          <div className="flex items-center gap-1">
            <PlanetFetchTimestamp entry={refreshEntry} />
            {onRefresh && <RefreshIconButton onRefresh={onRefresh} isLoading={refreshEntry.isLoading} />}
          </div>
        </div>
        {progress && (
          <div className="flex flex-col gap-0.5 text-sm">
            <span>
              Imperial: {progress.imperialCurrent.toLocaleString()} / {progress.imperialThreshold.toLocaleString()} ({progress.imperialPercent}%)
            </span>
            <span>
              Devastation: {progress.devastationCurrent.toLocaleString()} / {progress.devastationThreshold.toLocaleString()} ({progress.devastationPercent}%)
            </span>
            {captureRace && (
              <span className="font-bold italic">
                {captureRace.pointsRemaining.toLocaleString()} points from capture ({captureRace.leadingSide})
              </span>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Side Leaderboard</span>
            <LeaderboardBreakdownCell result={leaderboard?.side ?? null} />
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Faction Leaderboard</span>
            <LeaderboardBreakdownCell result={leaderboard?.faction ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}

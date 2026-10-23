import { FactionBadge, LeaderboardBreakdownCell } from "./crusade-cells";
import { PlanetDefenseBadge } from "./PlanetDefenseBadge";
import { PlanetFetchTimestamp } from "./PlanetFetchTimestamp";
import { PointsRateIndicator } from "./PointsRateIndicator";
import { RefreshIconButton } from "./RefreshIconButton";
import { StarIconButton } from "./StarIconButton";
import { TrackIconButton } from "./TrackIconButton";
import { Spinner } from "./Spinner";
import {
  computeCaptureRace,
  computeConquestProgress,
  cooldownRemainingMs,
  formatCooldownEndLocalTime,
  formatPointsFromCapture,
  isPlanetRanked,
} from "../crusade/crusade-domination-view-model";
import { computeHourlyAccruedRate, type TrackedPlanetSample } from "../crusade/planet-tracker-view-model";
import type { CrusadePlanet, PlanetDefenseCounts, PlanetRefreshEntry } from "../api/types";

const labelClass = "text-xs font-medium opacity-70";
const EMPTY_DEFENSES: PlanetDefenseCounts = { imperial: 0, devastation: 0 };

interface CrusadeDominationCardProps {
  planet: CrusadePlanet;
  refreshEntry: PlanetRefreshEntry;
  onSelectPlanet: (planetId: string) => void;
  onRefresh?: () => void;
  isFavorited: boolean;
  onToggleFavorite?: () => void;
  starDisabled?: boolean;
  isTracked?: boolean;
  onToggleTrack?: () => void;
  trackDisabled?: boolean;
  trackDisabledTitle?: string;
  otherTrackedPlanetName?: string;
  history?: TrackedPlanetSample[];
  defenses?: PlanetDefenseCounts;
}

export function CrusadeDominationCard({
  planet,
  refreshEntry,
  onSelectPlanet,
  onRefresh,
  isFavorited,
  onToggleFavorite,
  starDisabled,
  isTracked = false,
  onToggleTrack,
  trackDisabled,
  trackDisabledTitle,
  otherTrackedPlanetName,
  history = [],
  defenses = EMPTY_DEFENSES,
}: CrusadeDominationCardProps) {
  const leaderboard = refreshEntry.leaderboard ?? undefined;
  const progress = computeConquestProgress(planet);
  const captureRace = computeCaptureRace(planet);
  const ranked = isPlanetRanked(leaderboard);
  const nowMs = Date.now();
  const imperialRate = progress
    ? computeHourlyAccruedRate(
        history.filter((s) => s.imperialAccrued !== undefined).map((s) => ({ atMs: s.atMs, value: s.imperialAccrued! })),
        progress.imperialCurrent,
        nowMs,
      )
    : 0;
  const devastationRate = progress
    ? computeHourlyAccruedRate(
        history.filter((s) => s.devastationAccrued !== undefined).map((s) => ({ atMs: s.atMs, value: s.devastationAccrued! })),
        progress.devastationCurrent,
        nowMs,
      )
    : 0;
  const recaptureTimestamp = planet.struggleData?.recaptureTimestamp;
  const cooldownEndLocal = recaptureTimestamp != null && cooldownRemainingMs(planet, Date.now()) !== null ? formatCooldownEndLocalTime(recaptureTimestamp) : null;

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
            {onToggleFavorite && <StarIconButton isFavorited={isFavorited} onToggle={onToggleFavorite} disabled={starDisabled} />}
            <span className="font-medium">{planet.name}</span>
            <PlanetDefenseBadge imperial={defenses.imperial} devastation={defenses.devastation} />
          </div>
          <div className="flex items-center gap-1">
            {planet.ownedByFaction && <FactionBadge factionId={planet.ownedByFaction} />}
            {onToggleTrack && (
              <TrackIconButton
                isTracked={isTracked}
                onToggle={onToggleTrack}
                disabled={trackDisabled}
                disabledTitle={trackDisabledTitle}
                otherTrackedPlanetName={otherTrackedPlanetName}
              />
            )}
          </div>
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs opacity-70">Sector {(planet.zone ?? 0) + 1}</span>
          {onRefresh && (
            <div className="flex items-center gap-1">
              <PlanetFetchTimestamp entry={refreshEntry} />
              <RefreshIconButton onRefresh={onRefresh} isLoading={refreshEntry.isLoading} />
            </div>
          )}
        </div>
        {progress && (
          <div className="flex flex-col gap-0.5 text-sm">
            <span>
              Imperial: {progress.imperialCurrent.toLocaleString()} / {progress.imperialThreshold.toLocaleString()} ({progress.imperialPercent}%)
              <PointsRateIndicator pointsRemaining={progress.imperialThreshold - progress.imperialCurrent} hourlyRate={imperialRate} />
            </span>
            <span>
              Devastation: {progress.devastationCurrent.toLocaleString()} / {progress.devastationThreshold.toLocaleString()} ({progress.devastationPercent}%)
              <PointsRateIndicator pointsRemaining={progress.devastationThreshold - progress.devastationCurrent} hourlyRate={devastationRate} />
            </span>
            {captureRace && (
              <span className="font-bold italic">
                {formatPointsFromCapture(captureRace.pointsRemaining)} ({captureRace.leadingSide})
              </span>
            )}
            {cooldownEndLocal && <span className="text-xs opacity-70">Available again at {cooldownEndLocal}</span>}
          </div>
        )}
        {/* Unconditional (not gated on onRefresh) - an anonymous visitor (AnonymousCrusadeSection,
            no onRefresh) can still have leaderboard data here via the shared D1 cache
            (worker/leaderboard-cache.ts), just with no refresh/star/track controls above. */}
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

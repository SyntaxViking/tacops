import { isStarDisabled } from "../crusade/starred-planets";
import { isTrackDisabled } from "../crusade/tracked-planet";
import { FactionBadge, LeaderboardBreakdownCell } from "./crusade-cells";
import { PlanetDefenseBadge } from "./PlanetDefenseBadge";
import { PlanetFetchTimestamp } from "./PlanetFetchTimestamp";
import { PointsRateIndicator } from "./PointsRateIndicator";
import { RefreshIconButton } from "./RefreshIconButton";
import { StarIconButton } from "./StarIconButton";
import { TrackIconButton } from "./TrackIconButton";
import { Spinner } from "./Spinner";
import { EMPTY_REFRESH_ENTRY } from "./planet-refresh-defaults";
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

const cellClass = "border-b border-black/10 px-3 py-2 align-top dark:border-white/15";
const EMPTY_DEFENSES: PlanetDefenseCounts = { imperial: 0, devastation: 0 };

interface CrusadeDominationTableProps {
  planets: CrusadePlanet[];
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  onSelectPlanet: (planetId: string) => void;
  onRefreshPlanet?: (planetId: string) => void;
  favoritedPlanetIds: ReadonlySet<string>;
  onToggleFavoritePlanet?: (planetId: string) => void;
  trackedPlanetId?: string | null;
  onToggleTrackPlanet?: (planetId: string) => void;
  historyByPlanet?: Map<string, TrackedPlanetSample[]>;
  planetDefenses?: Record<string, PlanetDefenseCounts>;
}

export function CrusadeDominationTable({
  planets,
  planetRefreshState,
  onSelectPlanet,
  onRefreshPlanet,
  favoritedPlanetIds,
  onToggleFavoritePlanet,
  trackedPlanetId = null,
  onToggleTrackPlanet,
  historyByPlanet,
  planetDefenses,
}: CrusadeDominationTableProps) {
  const trackedPlanetName = trackedPlanetId ? planets.find((p) => p.planetId === trackedPlanetId)?.name : undefined;
  const nowMs = Date.now();
  return (
    <table className="mt-4 w-full table-auto border-collapse text-left">
      <thead>
        <tr>
          <th className={cellClass}>Favorite</th>
          <th className={cellClass}>Planet</th>
          <th className={cellClass}>Sector</th>
          <th className={cellClass}>Owner</th>
          <th className={cellClass}>Imperial</th>
          <th className={cellClass}>Devastation</th>
          <th className={cellClass}>Side Leaderboard</th>
          <th className={cellClass}>Faction Leaderboard</th>
          <th className={cellClass}>Defenses</th>
          <th className={cellClass}>Fetched</th>
        </tr>
      </thead>
      <tbody>
        {planets.map((planet) => {
          const refreshEntry = planetRefreshState.get(planet.planetId) ?? EMPTY_REFRESH_ENTRY;
          const leaderboard = refreshEntry.leaderboard ?? undefined;
          const progress = computeConquestProgress(planet);
          const captureRace = computeCaptureRace(planet);
          const ranked = isPlanetRanked(leaderboard);
          const recaptureTimestamp = planet.struggleData?.recaptureTimestamp;
          const cooldownEndLocal = recaptureTimestamp != null && cooldownRemainingMs(planet, nowMs) !== null ? formatCooldownEndLocalTime(recaptureTimestamp) : null;
          const history = historyByPlanet?.get(planet.planetId) ?? [];
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
          const defenses = planetDefenses?.[planet.planetId] ?? EMPTY_DEFENSES;
          return (
            <tr
              key={planet.planetId}
              onClick={() => onSelectPlanet(planet.planetId)}
              className={`cursor-pointer ${ranked ? "bg-blue-50 dark:bg-blue-950/30" : ""} ${
                refreshEntry.isLoading ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <td className={cellClass}>
                {onToggleFavoritePlanet && (
                  <StarIconButton
                    isFavorited={favoritedPlanetIds.has(planet.planetId)}
                    onToggle={() => onToggleFavoritePlanet(planet.planetId)}
                    disabled={isStarDisabled(favoritedPlanetIds, planet.planetId)}
                  />
                )}
              </td>
              <td className={cellClass}>{planet.name}</td>
              <td className={cellClass}>{(planet.zone ?? 0) + 1}</td>
              <td className={cellClass}>
                <div className="flex items-center gap-1">
                  {planet.ownedByFaction && <FactionBadge factionId={planet.ownedByFaction} />}
                  {onToggleTrackPlanet && (
                    <TrackIconButton
                      isTracked={trackedPlanetId === planet.planetId}
                      onToggle={() => onToggleTrackPlanet(planet.planetId)}
                      disabled={isTrackDisabled(trackedPlanetId, planet)}
                      disabledTitle="Not currently available to track (already captured or in cooldown)"
                      otherTrackedPlanetName={trackedPlanetName}
                    />
                  )}
                </div>
              </td>
              <td className={cellClass}>
                {progress && (
                  <div className="flex flex-col gap-0.5">
                    <span>
                      {progress.imperialCurrent.toLocaleString()} / {progress.imperialThreshold.toLocaleString()} ({progress.imperialPercent}%)
                      <PointsRateIndicator pointsRemaining={progress.imperialThreshold - progress.imperialCurrent} hourlyRate={imperialRate} />
                    </span>
                    {captureRace?.leadingSide === "Imperial" && <span className="font-bold italic">{formatPointsFromCapture(captureRace.pointsRemaining)}</span>}
                    {captureRace?.leadingSide === "Imperial" && cooldownEndLocal && <span className="text-xs opacity-70">Available again at {cooldownEndLocal}</span>}
                  </div>
                )}
              </td>
              <td className={cellClass}>
                {progress && (
                  <div className="flex flex-col gap-0.5">
                    <span>
                      {progress.devastationCurrent.toLocaleString()} / {progress.devastationThreshold.toLocaleString()} ({progress.devastationPercent}%)
                      <PointsRateIndicator pointsRemaining={progress.devastationThreshold - progress.devastationCurrent} hourlyRate={devastationRate} />
                    </span>
                    {captureRace?.leadingSide === "Devastation" && <span className="font-bold italic">{formatPointsFromCapture(captureRace.pointsRemaining)}</span>}
                    {captureRace?.leadingSide === "Devastation" && cooldownEndLocal && <span className="text-xs opacity-70">Available again at {cooldownEndLocal}</span>}
                  </div>
                )}
              </td>
              <td className={cellClass}>
                <LeaderboardBreakdownCell result={leaderboard?.side ?? null} />
              </td>
              <td className={cellClass}>
                <LeaderboardBreakdownCell result={leaderboard?.faction ?? null} />
              </td>
              <td className={cellClass}>
                <PlanetDefenseBadge imperial={defenses.imperial} devastation={defenses.devastation} />
              </td>
              <td className={cellClass}>
                <div className="flex items-center gap-1">
                  {refreshEntry.isLoading ? <Spinner size={20} /> : <PlanetFetchTimestamp entry={refreshEntry} />}
                  {onRefreshPlanet && <RefreshIconButton onRefresh={() => onRefreshPlanet(planet.planetId)} isLoading={refreshEntry.isLoading} />}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

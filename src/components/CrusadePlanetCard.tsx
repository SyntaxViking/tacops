import { FactionBadge, LeaderboardBreakdownCell, SidePercentCell } from "./crusade-cells";
import { PlanetFetchTimestamp } from "./PlanetFetchTimestamp";
import { RefreshIconButton } from "./RefreshIconButton";
import { StarIconButton } from "./StarIconButton";
import { Spinner } from "./Spinner";
import type { CrusadePlanet, PlanetRefreshEntry } from "../api/types";

const labelClass = "text-xs font-medium opacity-70";

interface CrusadePlanetCardProps {
  planet: CrusadePlanet;
  refreshEntry: PlanetRefreshEntry;
  onRefresh: () => void;
  isFavorited: boolean;
  onToggleFavorite: () => void;
}

export function CrusadePlanetCard({ planet, refreshEntry, onRefresh, isFavorited, onToggleFavorite }: CrusadePlanetCardProps) {
  const leaderboard = refreshEntry.leaderboard;
  return (
    <div className="relative">
      {refreshEntry.isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70 dark:bg-neutral-900/70">
          <Spinner size={36} />
        </div>
      )}
      <div
        className={`flex flex-col gap-2 rounded-lg border border-black/10 bg-white/60 p-3 text-left dark:border-white/15 dark:bg-white/5 ${
          refreshEntry.isLoading ? "pointer-events-none" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <StarIconButton isFavorited={isFavorited} onToggle={onToggleFavorite} />
            <span className="font-medium">{planet.name}</span>
          </div>
          <SidePercentCell pointsFor={planet.pointsFor} pointsAgainst={planet.pointsAgainst} />
        </div>
        <div className="flex items-center justify-end gap-1">
          <PlanetFetchTimestamp entry={refreshEntry} />
          <RefreshIconButton onRefresh={onRefresh} isLoading={refreshEntry.isLoading} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Leading Factions (Imperium)</span>
            {(leaderboard?.topFactionsFor ?? []).slice(0, 3).map((f) => (
              <div key={f.factionId} className="flex items-center gap-1">
                <FactionBadge factionId={f.factionId} />
                <span>{f.points.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Leading Factions (Devastation)</span>
            {(leaderboard?.topFactionsAgainst ?? []).slice(0, 3).map((f) => (
              <div key={f.factionId} className="flex items-center gap-1">
                <FactionBadge factionId={f.factionId} />
                <span>{f.points.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
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

import { LeaderboardBreakdownCell, LeadingFactionsCell, SidePercentCell } from "./crusade-cells";
import { PlanetFetchTimestamp } from "./PlanetFetchTimestamp";
import { RefreshIconButton } from "./RefreshIconButton";
import { StarIconButton } from "./StarIconButton";
import { Spinner } from "./Spinner";
import type { CrusadePlanet, PlanetRefreshEntry } from "../api/types";

const labelClass = "text-xs font-medium opacity-70";

interface CrusadePlanetCardProps {
  planet: CrusadePlanet;
  refreshEntry: PlanetRefreshEntry;
  onRefresh?: () => void;
  isFavorited: boolean;
  onToggleFavorite?: () => void;
  // Set only by the anonymous home-page view (AnonymousCrusadeSection, via its faction picker) -
  // shows just the picked faction's side instead of both. Never set for logged-in usage, which
  // always sees both sides exactly as before.
  factionSideFilter?: "for" | "against";
}

export function CrusadePlanetCard({ planet, refreshEntry, onRefresh, isFavorited, onToggleFavorite, factionSideFilter }: CrusadePlanetCardProps) {
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
            {onToggleFavorite && <StarIconButton isFavorited={isFavorited} onToggle={onToggleFavorite} />}
            <span className="font-medium">{planet.name}</span>
          </div>
          <SidePercentCell pointsFor={planet.pointsFor} pointsAgainst={planet.pointsAgainst} />
        </div>
        <div className="flex items-center justify-end gap-1">
          <PlanetFetchTimestamp entry={refreshEntry} />
          {onRefresh && <RefreshIconButton onRefresh={onRefresh} isLoading={refreshEntry.isLoading} />}
        </div>
        {factionSideFilter ? (
          <LeadingFactionsCell
            label={factionSideFilter === "for" ? "Leading Factions (Imperium)" : "Leading Factions (Devastation)"}
            standings={(factionSideFilter === "for" ? leaderboard?.topFactionsFor : leaderboard?.topFactionsAgainst) ?? []}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <LeadingFactionsCell label="Leading Factions (Imperium)" standings={leaderboard?.topFactionsFor ?? []} />
            <LeadingFactionsCell label="Leading Factions (Devastation)" standings={leaderboard?.topFactionsAgainst ?? []} />
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

import { isStarDisabled } from "../crusade/starred-planets";
import { FactionBadge, LeaderboardBreakdownCell, PlanetResourceIcon, SidePercentCell } from "./crusade-cells";
import { PlanetFetchTimestamp } from "./PlanetFetchTimestamp";
import { RefreshIconButton } from "./RefreshIconButton";
import { StarIconButton } from "./StarIconButton";
import { Spinner } from "./Spinner";
import { EMPTY_REFRESH_ENTRY } from "./planet-refresh-defaults";
import type { CrusadePlanet, PlanetRefreshEntry } from "../api/types";

const cellClass = "border-b border-black/10 px-3 py-2 align-top dark:border-white/15";

interface CrusadePlanetsTableProps {
  planets: CrusadePlanet[];
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  onRefreshPlanet?: (planetId: string) => void;
  favoritedPlanetIds: ReadonlySet<string>;
  onToggleFavoritePlanet?: (planetId: string) => void;
  // Opens the sector-map modal for this planet - required (not optional), same as
  // CrusadeDominationTable's own onSelectPlanet: viewing the map doesn't need an account, so it's
  // always available even on the anonymous home page.
  onSelectPlanet: (planetId: string) => void;
}

export function CrusadePlanetsTable({
  planets,
  planetRefreshState,
  onRefreshPlanet,
  favoritedPlanetIds,
  onToggleFavoritePlanet,
  onSelectPlanet,
}: CrusadePlanetsTableProps) {
  return (
    <table className="mt-4 w-full table-auto border-collapse text-left">
      <thead>
        <tr>
          <th className={cellClass}>Favorite</th>
          <th className={cellClass}>Planet</th>
          <th className={cellClass}>Imperium / Devastation</th>
          {/* Leaderboard columns are unconditional (not gated on onRefreshPlanet) - an anonymous
              visitor (AnonymousCrusadeSection, no onRefreshPlanet) can still have leaderboard data
              via the shared D1 cache (worker/leaderboard-cache.ts); only "Fetched" (the refresh
              control) needs an account to act on. */}
          <th className={cellClass}>Leading Factions (Imperium)</th>
          <th className={cellClass}>Leading Factions (Devastation)</th>
          <th className={cellClass}>Side Leaderboard</th>
          <th className={cellClass}>Faction Leaderboard</th>
          {onRefreshPlanet && <th className={cellClass}>Fetched</th>}
        </tr>
      </thead>
      <tbody>
        {planets.map((planet) => {
          const refreshEntry = planetRefreshState.get(planet.planetId) ?? EMPTY_REFRESH_ENTRY;
          const lb = refreshEntry.leaderboard;
          return (
            <tr
              key={planet.planetId}
              onClick={() => onSelectPlanet(planet.planetId)}
              className={`cursor-pointer ${refreshEntry.isLoading ? "pointer-events-none opacity-60" : ""}`}
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
              <td className={cellClass}>
                <div className="flex items-center gap-1">
                  {planet.name}
                  <PlanetResourceIcon planetId={planet.planetId} />
                </div>
              </td>
              <td className={cellClass}>
                <SidePercentCell pointsFor={planet.pointsFor} pointsAgainst={planet.pointsAgainst} />
              </td>
              <td className={cellClass}>
                {(lb?.topFactionsFor ?? []).slice(0, 3).map((f) => (
                  <div key={f.factionId} className="flex items-center gap-1">
                    <FactionBadge factionId={f.factionId} />
                    <span>{f.points.toLocaleString()}</span>
                  </div>
                ))}
              </td>
              <td className={cellClass}>
                {(lb?.topFactionsAgainst ?? []).slice(0, 3).map((f) => (
                  <div key={f.factionId} className="flex items-center gap-1">
                    <FactionBadge factionId={f.factionId} />
                    <span>{f.points.toLocaleString()}</span>
                  </div>
                ))}
              </td>
              <td className={cellClass}>
                <LeaderboardBreakdownCell result={lb?.side ?? null} />
              </td>
              <td className={cellClass}>
                <LeaderboardBreakdownCell result={lb?.faction ?? null} />
              </td>
              {onRefreshPlanet && (
                <td className={cellClass}>
                  <div className="flex items-center gap-1">
                    {refreshEntry.isLoading ? <Spinner size={20} /> : <PlanetFetchTimestamp entry={refreshEntry} />}
                    <RefreshIconButton onRefresh={() => onRefreshPlanet(planet.planetId)} isLoading={refreshEntry.isLoading} />
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

import { LeaderboardBreakdownCell, LeadingFactionsCell, SidePercentCell } from "./crusade-cells";
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
  factionSideFilter?: "for" | "against";
}

export function CrusadePlanetsTable({
  planets,
  planetRefreshState,
  onRefreshPlanet,
  favoritedPlanetIds,
  onToggleFavoritePlanet,
  factionSideFilter,
}: CrusadePlanetsTableProps) {
  return (
    <table className="mt-4 w-full table-auto border-collapse text-left">
      <thead>
        <tr>
          <th className={cellClass}>Favorite</th>
          <th className={cellClass}>Planet</th>
          <th className={cellClass}>Imperium % / Devastation %</th>
          {factionSideFilter ? (
            <th className={cellClass}>Leading Factions</th>
          ) : (
            <>
              <th className={cellClass}>Leading Factions (Imperium)</th>
              <th className={cellClass}>Leading Factions (Devastation)</th>
            </>
          )}
          <th className={cellClass}>Side Leaderboard</th>
          <th className={cellClass}>Faction Leaderboard</th>
          <th className={cellClass}>Fetched</th>
        </tr>
      </thead>
      <tbody>
        {planets.map((planet) => {
          const refreshEntry = planetRefreshState.get(planet.planetId) ?? EMPTY_REFRESH_ENTRY;
          const lb = refreshEntry.leaderboard;
          return (
            <tr key={planet.planetId} className={refreshEntry.isLoading ? "pointer-events-none opacity-60" : ""}>
              <td className={cellClass}>
                {onToggleFavoritePlanet && (
                  <StarIconButton isFavorited={favoritedPlanetIds.has(planet.planetId)} onToggle={() => onToggleFavoritePlanet(planet.planetId)} />
                )}
              </td>
              <td className={cellClass}>{planet.name}</td>
              <td className={cellClass}>
                <SidePercentCell pointsFor={planet.pointsFor} pointsAgainst={planet.pointsAgainst} />
              </td>
              {factionSideFilter ? (
                <td className={cellClass}>
                  <LeadingFactionsCell
                    label=""
                    standings={(factionSideFilter === "for" ? lb?.topFactionsFor : lb?.topFactionsAgainst) ?? []}
                  />
                </td>
              ) : (
                <>
                  <td className={cellClass}>
                    <LeadingFactionsCell label="" standings={lb?.topFactionsFor ?? []} />
                  </td>
                  <td className={cellClass}>
                    <LeadingFactionsCell label="" standings={lb?.topFactionsAgainst ?? []} />
                  </td>
                </>
              )}
              <td className={cellClass}>
                <LeaderboardBreakdownCell result={lb?.side ?? null} />
              </td>
              <td className={cellClass}>
                <LeaderboardBreakdownCell result={lb?.faction ?? null} />
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

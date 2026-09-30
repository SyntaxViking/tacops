import { isStarDisabled } from "../crusade/starred-planets";
import { isPlanetTrackable, isTrackDisabled } from "../crusade/tracked-planet";
import { CrusadeDominationCard } from "./CrusadeDominationCard";
import { EMPTY_REFRESH_ENTRY } from "./planet-refresh-defaults";
import type { CrusadePlanet, PlanetRefreshEntry } from "../api/types";

interface CrusadeDominationCardsProps {
  planets: CrusadePlanet[];
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  onSelectPlanet: (planetId: string) => void;
  onRefreshPlanet?: (planetId: string) => void;
  favoritedPlanetIds: ReadonlySet<string>;
  onToggleFavoritePlanet?: (planetId: string) => void;
  trackedPlanetId?: string | null;
  onToggleTrackPlanet?: (planetId: string) => void;
}

export function CrusadeDominationCards({
  planets,
  planetRefreshState,
  onSelectPlanet,
  onRefreshPlanet,
  favoritedPlanetIds,
  onToggleFavoritePlanet,
  trackedPlanetId = null,
  onToggleTrackPlanet,
}: CrusadeDominationCardsProps) {
  const trackedPlanetName = trackedPlanetId ? planets.find((p) => p.planetId === trackedPlanetId)?.name : undefined;
  return (
    <div className="mt-4 grid w-full grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {planets.map((planet) => (
        <CrusadeDominationCard
          key={planet.planetId}
          planet={planet}
          refreshEntry={planetRefreshState.get(planet.planetId) ?? EMPTY_REFRESH_ENTRY}
          onSelectPlanet={onSelectPlanet}
          onRefresh={onRefreshPlanet ? () => onRefreshPlanet(planet.planetId) : undefined}
          isFavorited={favoritedPlanetIds.has(planet.planetId)}
          onToggleFavorite={onToggleFavoritePlanet ? () => onToggleFavoritePlanet(planet.planetId) : undefined}
          starDisabled={isStarDisabled(favoritedPlanetIds, planet.planetId)}
          isTracked={trackedPlanetId === planet.planetId}
          onToggleTrack={onToggleTrackPlanet ? () => onToggleTrackPlanet(planet.planetId) : undefined}
          trackDisabled={isTrackDisabled(trackedPlanetId, planet.planetId) || (trackedPlanetId === null && !isPlanetTrackable(planet))}
          trackDisabledTitle={
            isTrackDisabled(trackedPlanetId, planet.planetId)
              ? `Untrack ${trackedPlanetName ?? "the other planet"} first - only one planet can be tracked at a time`
              : "Not currently available to track (already captured or in cooldown)"
          }
        />
      ))}
    </div>
  );
}

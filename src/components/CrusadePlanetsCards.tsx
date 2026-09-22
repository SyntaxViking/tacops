import { CrusadePlanetCard } from "./CrusadePlanetCard";
import { EMPTY_REFRESH_ENTRY } from "./planet-refresh-defaults";
import type { CrusadePlanet, PlanetRefreshEntry } from "../api/types";

interface CrusadePlanetsCardsProps {
  planets: CrusadePlanet[];
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  onRefreshPlanet: (planetId: string) => void;
  favoritedPlanetIds: ReadonlySet<string>;
  onToggleFavoritePlanet: (planetId: string) => void;
}

export function CrusadePlanetsCards({
  planets,
  planetRefreshState,
  onRefreshPlanet,
  favoritedPlanetIds,
  onToggleFavoritePlanet,
}: CrusadePlanetsCardsProps) {
  return (
    <div className="mt-4 grid w-full grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {planets.map((planet) => (
        <CrusadePlanetCard
          key={planet.planetId}
          planet={planet}
          refreshEntry={planetRefreshState.get(planet.planetId) ?? EMPTY_REFRESH_ENTRY}
          onRefresh={() => onRefreshPlanet(planet.planetId)}
          isFavorited={favoritedPlanetIds.has(planet.planetId)}
          onToggleFavorite={() => onToggleFavoritePlanet(planet.planetId)}
        />
      ))}
    </div>
  );
}

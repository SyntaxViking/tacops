import { CrusadeDominationCard } from "./CrusadeDominationCard";
import { EMPTY_REFRESH_ENTRY } from "./planet-refresh-defaults";
import type { CrusadePlanet, PlanetRefreshEntry } from "../api/types";

interface CrusadeDominationCardsProps {
  planets: CrusadePlanet[];
  planetRefreshState: Map<string, PlanetRefreshEntry>;
  onSelectPlanet: (planetId: string) => void;
  onRefreshPlanet: (planetId: string) => void;
  favoritedPlanetIds: ReadonlySet<string>;
  onToggleFavoritePlanet: (planetId: string) => void;
}

export function CrusadeDominationCards({
  planets,
  planetRefreshState,
  onSelectPlanet,
  onRefreshPlanet,
  favoritedPlanetIds,
  onToggleFavoritePlanet,
}: CrusadeDominationCardsProps) {
  return (
    <div className="mt-4 grid w-full grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {planets.map((planet) => (
        <CrusadeDominationCard
          key={planet.planetId}
          planet={planet}
          refreshEntry={planetRefreshState.get(planet.planetId) ?? EMPTY_REFRESH_ENTRY}
          onSelectPlanet={onSelectPlanet}
          onRefresh={() => onRefreshPlanet(planet.planetId)}
          isFavorited={favoritedPlanetIds.has(planet.planetId)}
          onToggleFavorite={() => onToggleFavoritePlanet(planet.planetId)}
        />
      ))}
    </div>
  );
}

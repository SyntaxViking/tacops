import { useState } from "react";
import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { StarIconButton } from "./StarIconButton";
import { ThumbsDownIconButton } from "./ThumbsDownIconButton";
import { CharacterSortModeToggle } from "./CharacterSortModeToggle";
import { getCharacterRow, sortCharacterRows, type CharacterSortMode } from "../characters/character-view-model";
import type { RawUnit } from "../api/types";

const cellClass = "border-b border-black/10 px-3 py-2 align-top dark:border-white/15";

interface CharactersTableProps {
  heroes: RawUnit[];
  favoritedCharacterIds: ReadonlySet<string>;
  onToggleFavorite: (characterId: string) => void;
  antiFavoritedCharacterIds: ReadonlySet<string>;
  onToggleAntiFavorite: (characterId: string) => void;
}

export function CharactersTable({
  heroes,
  favoritedCharacterIds,
  onToggleFavorite,
  antiFavoritedCharacterIds,
  onToggleAntiFavorite,
}: CharactersTableProps) {
  const [sortMode, setSortMode] = useState<CharacterSortMode>("powerDesc");

  if (heroes.length === 0) {
    return <p>No characters found.</p>;
  }

  const sortedRows = sortCharacterRows(heroes.map(getCharacterRow), sortMode);

  return (
    <>
      <CharacterSortModeToggle value={sortMode} onChange={setSortMode} />
      <table className="mt-4 w-full table-auto border-collapse text-left">
        <thead>
          <tr>
            <th className={cellClass}>Character</th>
            <th className={cellClass}>Favorite</th>
            <th className={cellClass}>Deprioritize</th>
            <th className={cellClass}>Portrait</th>
            <th className={cellClass}>Faction</th>
            <th className={cellClass}>Rarity</th>
            <th className={cellClass}>Stars</th>
            <th className={cellClass}>Rank</th>
            <th className={cellClass}>Damage Profile</th>
            <th className={cellClass}>Traits</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.id}>
              <td className={cellClass}>{row.name}</td>
              <td className={cellClass}>
                <StarIconButton isFavorited={favoritedCharacterIds.has(row.id)} onToggle={() => onToggleFavorite(row.id)} />
              </td>
              <td className={cellClass}>
                <ThumbsDownIconButton isAntiFavorited={antiFavoritedCharacterIds.has(row.id)} onToggle={() => onToggleAntiFavorite(row.id)} />
              </td>
              <td className={cellClass}>
                <Icon
                  src={row.portraitUrl}
                  title={`${row.id} (Power: ${row.power?.toLocaleString() ?? "unknown"})`}
                />
              </td>
              <td className={cellClass}>{row.factionIconUrl ? <Icon src={row.factionIconUrl} /> : row.faction}</td>
              <td className={cellClass}>
                <Icon src={row.rarityIconUrl} />
              </td>
              <td className={cellClass}>
                <IconRow>
                  {row.starIconUrls.map((url, i) => (
                    <Icon key={i} src={url} />
                  ))}
                </IconRow>
              </td>
              <td className={cellClass}>
                <Icon src={row.rankIconUrl} />
              </td>
              <td className={cellClass}>
                <IconRow>
                  {row.damageProfileIconUrls.map((url, i) => (
                    <Icon key={i} src={url} />
                  ))}
                </IconRow>
              </td>
              <td className={cellClass}>
                <IconRow>
                  {row.traitIconUrls.map((url, i) => (
                    <Icon key={i} src={url} />
                  ))}
                </IconRow>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

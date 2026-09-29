import type { ReplayPlaylistCharacterSlotRow } from "../../library/replay-playlist-battle-view-model";

// One character in a battle's lineup: a large portrait with the rank icon overlaid top-left, the
// rarity icon overlaid top-right, the star cluster overlaid along the bottom edge, and the two
// ability levels as plain text underneath - same four icon categories (character/rank/rarity/
// stars) the reference page shows, just arranged as overlays on one bigger portrait instead of
// separate table columns (see CharactersTable.tsx for the column version of the same data).
export function ReplayPlaylistCharacterSlotBadge({ row }: { row: ReplayPlaylistCharacterSlotRow }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <div className="relative h-16 w-16">
        <img src={row.portraitUrl} title={row.name} className="h-16 w-16 rounded-full object-cover" />
        <img src={row.rankIconUrl} title="Rank" className="absolute -top-1 -left-1 h-5 w-5 rounded-full" />
        <img src={row.rarityIconUrl} title="Rarity" className="absolute -top-1 -right-1 h-5 w-5 rounded-full" />
        {row.starIconUrls.length > 0 && (
          <div className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-px">
            {row.starIconUrls.map((url, i) => (
              <img key={i} src={url} className="h-3 w-3" />
            ))}
          </div>
        )}
      </div>
      <span className="text-xs text-neutral-300">
        {row.abilityLevel1}/{row.abilityLevel2}
      </span>
    </div>
  );
}

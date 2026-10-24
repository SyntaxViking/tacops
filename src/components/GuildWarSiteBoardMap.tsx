import { useCallback, useEffect, useState } from "react";
import { BoardImage } from "./BoardImage";
import { characterPortraitUrl } from "../characters/character-portraits";
import { fetchSpawnPointManifest, resolveSpawnPositionsForTeam, type SpawnPointManifest } from "../pvp/board-layout";

// Both players place from the same spawn-point group - teamWithPlayerIndex 1 ("player 2's" side)
// - regardless of which of the site's two players' lineup is actually selected; player 1's own
// index (0) is never used for placement. Confirmed by the user; the underlying game reason is
// still a TODO to capture here once we get it.
const PLACEMENT_TEAM_INDEX = 1;

export interface GuildWarLineupSelection {
  characterIds: readonly string[];
  defeatedByCharacterId: ReadonlyMap<string, boolean>;
}

interface GuildWarSiteBoardMapProps {
  boardId: string;
  spawnPointsSet: number | null;
  selection: GuildWarLineupSelection | null;
}

// Board art plus (once a lineup is selected) that lineup's character portraits at their real
// spawn points - same mechanism as ArenaBoardMap, just via resolveSpawnPositionsForTeam's
// explicit team-index parameter (see PLACEMENT_TEAM_INDEX above) instead of ArenaBoardMap's own
// hardcoded opponent-only lookup.
export function GuildWarSiteBoardMap({ boardId, spawnPointsSet, selection }: GuildWarSiteBoardMapProps) {
  const [manifest, setManifest] = useState<SpawnPointManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSpawnPointManifest()
      .then((loaded) => {
        if (!cancelled) setManifest(loaded);
      })
      .catch((loadError) => {
        if (!cancelled) setError(`Failed to load spawn point data: ${loadError}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // See ArenaBoardMap's own comment for why this must be a stable (useCallback, empty deps) ref
  // callback rather than a plain inline function - avoids an infinite update loop when the board
  // image is already in the browser's cache.
  const handleImgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, []);

  const positions =
    manifest && naturalSize && selection && spawnPointsSet !== null
      ? resolveSpawnPositionsForTeam(manifest, boardId, spawnPointsSet, PLACEMENT_TEAM_INDEX, selection.characterIds)
      : [];

  return (
    <div className="relative inline-block max-w-full">
      <BoardImage boardId={boardId} imgRef={handleImgRef} className="block max-w-full rounded" onLoadSize={setNaturalSize} />
      {naturalSize &&
        positions.map((position, i) => (
          <img
            key={`${position.characterId}-${i}`}
            src={characterPortraitUrl(position.characterId)}
            title={position.characterId}
            className={`absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 object-cover shadow ${
              selection?.defeatedByCharacterId.get(position.characterId) ? "opacity-40 grayscale" : ""
            }`}
            style={{ left: `${(position.x / naturalSize.width) * 100}%`, top: `${(position.y / naturalSize.height) * 100}%` }}
          />
        ))}
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}

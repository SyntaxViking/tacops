import { useCallback, useEffect, useState } from "react";
import { BoardImage } from "./BoardImage";
import { fetchSpawnPointManifest, resolveCharacterSpawnPositions, type SpawnPointManifest } from "../pvp/board-layout";
import { characterPortraitUrl } from "../characters/character-portraits";

interface ArenaBoardMapProps {
  boardId: string;
  spawnPointsSet: number;
  lineup: string[];
}

// The board background plus the opponent's fielded character portraits (bare - no rank/stars/
// etc., per the user's request) at their real spawn points. spawn-points.json's (x, y) are native
// pixel coordinates against the delivered board PNG (confirmed by datamine_tacticus drawing its
// own output back onto that same PNG) - positioned here as a percentage of the image's natural
// size rather than raw px, so this still lines up however large the image actually renders at.
//
// naturalSize has two ways in, not just onLoad: a board that's already in the browser's cache
// (a repeat opponent board across a refresh, two of today's three opponents sharing a board, or
// just revisiting the tab later in the session) can resolve from cache without the <img> firing a
// load event at all - the board art still displays fine either way (that doesn't depend on load
// firing), but naturalSize staying unset meant the portraits silently never appeared, even though
// the underlying spawn-point data was correct. handleImgRef checks img.complete the moment the DOM
// node is attached and reads the size synchronously when it's already cached; onLoad still covers
// the normal first-fetch case.
//
// handleImgRef (passed through to BoardImage's own <img>) MUST be wrapped in useCallback (empty
// deps, so its identity never changes) - a plain inline function is recreated every render, and
// React re-invokes a *changed* ref callback on every render it sees a new identity, not just on
// real mount/unmount. For an already-cached image that's an infinite loop: ref fires -> sets state
// -> re-render -> new function identity -> ref fires again -> sets state again -> ... (confirmed
// as the real cause of a white-screen "Maximum update depth exceeded" crash from an earlier
// version of this fix that used a plain inline function here).
export function ArenaBoardMap({ boardId, spawnPointsSet, lineup }: ArenaBoardMapProps) {
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

  const handleImgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, []);

  const positions =
    manifest && naturalSize ? resolveCharacterSpawnPositions(manifest, boardId, spawnPointsSet, lineup) : [];

  return (
    <div className="relative inline-block max-w-full">
      <BoardImage boardId={boardId} imgRef={handleImgRef} className="block max-w-full rounded" onLoadSize={setNaturalSize} />
      {naturalSize &&
        positions.map((position) => (
          <img
            key={position.characterId}
            src={characterPortraitUrl(position.characterId)}
            title={position.characterId}
            className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 object-cover shadow"
            style={{
              left: `${(position.x / naturalSize.width) * 100}%`,
              top: `${(position.y / naturalSize.height) * 100}%`,
            }}
          />
        ))}
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}

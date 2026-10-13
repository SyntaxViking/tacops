import { useEffect, useState } from "react";
import { boardImageUrl, localBoardImageDataUrl } from "../pvp/board-image";

interface BoardImageProps {
  boardId: string;
  className?: string;
  imgRef?: (img: HTMLImageElement | null) => void;
  onLoadSize?: (size: { width: number; height: number }) => void;
}

// Shared by ArenaBoardMap and OnslaughtBoardMap: renders the board art from the deployed Worker,
// falling back (Tauri only, via localBoardImageDataUrl) to a locally-extracted copy in
// board-assets/boards/ when the remote image 404s/fails - lets newly-extracted board art be
// checked in the desktop app before it's actually been deployed.
export function BoardImage({ boardId, className, imgRef, onLoadSize }: BoardImageProps) {
  const [src, setSrc] = useState(() => boardImageUrl(boardId));
  const [triedLocalFallback, setTriedLocalFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSrc(boardImageUrl(boardId));
    setTriedLocalFallback(false);
    setError(null);
  }, [boardId]);

  const handleError = () => {
    if (triedLocalFallback) {
      setError(`Failed to load map art for ${boardId}`);
      return;
    }
    setTriedLocalFallback(true);
    localBoardImageDataUrl(boardId)
      .then((dataUrl) => {
        if (dataUrl) {
          setSrc(dataUrl);
        } else {
          setError(`Failed to load map art for ${boardId}`);
        }
      })
      .catch(() => setError(`Failed to load map art for ${boardId}`));
  };

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt={boardId}
        title={boardId}
        className={className}
        onLoad={(e) => onLoadSize?.({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        onError={handleError}
      />
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </>
  );
}

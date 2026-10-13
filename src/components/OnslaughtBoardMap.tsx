import { BoardImage } from "./BoardImage";

interface OnslaughtBoardMapProps {
  boardId: string;
}

// No character portraits to overlay here - unlike Arena's PVP boards, there's no opposing lineup
// to place, so this is just the board art itself (no naturalSize/cached-image tracking needed).
export function OnslaughtBoardMap({ boardId }: OnslaughtBoardMapProps) {
  return (
    <div className="inline-block max-w-full">
      <BoardImage boardId={boardId} className="block max-w-full rounded" />
    </div>
  );
}

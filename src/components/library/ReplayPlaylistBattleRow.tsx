import { getReplayPlaylistCharacterSlotRow, type ReplayPlaylistBattle } from "../../library/replay-playlist-battle-view-model";
import { ReplayPlaylistCharacterSlotBadge } from "./ReplayPlaylistCharacterSlotBadge";

// The whole row links out to its raidman.com replay - external site, so a new tab (and the usual
// noopener/noreferrer since target="_blank" otherwise hands the opened page a live reference back
// to this one).
export function ReplayPlaylistBattleRow({ battle }: { battle: ReplayPlaylistBattle }) {
  return (
    <a
      href={battle.replayUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:border-white/30 hover:bg-white/10"
    >
      <span className="w-24 shrink-0 text-lg font-semibold text-neutral-100">Battle {battle.battleNumber}</span>
      <div className="flex flex-wrap gap-4">
        {battle.characters.map((slot, i) => (
          <ReplayPlaylistCharacterSlotBadge key={i} row={getReplayPlaylistCharacterSlotRow(slot)} />
        ))}
      </div>
    </a>
  );
}

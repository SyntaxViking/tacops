import type { ReplayPlaylistBattle } from "../../library/replay-playlist-battle-view-model";
import { ReplayPlaylistBattleRow } from "./ReplayPlaylistBattleRow";

interface ReplayPlaylistBattleListPageProps {
  title: string;
  battles: ReplayPlaylistBattle[];
}

// Top-level page for a single replay playlist's lineup reference (e.g.
// library/reanimator-incursion-mythic-2) - a standalone page (its own Vite entry, not part of the
// main TacOps app's tabs) since it's a personal reference doc, not account data. Dark by design,
// matching the raidman.com page this was modeled on rather than the main app's light/dark theming.
export function ReplayPlaylistBattleListPage({ title, battles }: ReplayPlaylistBattleListPageProps) {
  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        {battles.map((battle) => (
          <ReplayPlaylistBattleRow key={battle.battleNumber} battle={battle} />
        ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { OnslaughtBoardMap } from "./OnslaughtBoardMap";
import { OnslaughtRankSelect } from "./OnslaughtRankSelect";
import type { OnslaughtAlliance, OnslaughtBoards } from "../api/types";

// Display order requested by the user: Imperial, Xenos, Chaos.
const ALLIANCES: OnslaughtAlliance[] = ["Imperial", "Xenos", "Chaos"];

interface OnslaughtTabProps {
  onslaughtBoards: OnslaughtBoards;
}

export function OnslaughtTab({ onslaughtBoards }: OnslaughtTabProps) {
  // Defaults to each alliance's own highest/most recently unlocked tier - the most likely one to
  // actually be queued into next. Each alliance progresses independently (see
  // onslaught-extraction.ts), so this is computed per alliance, not shared.
  const [selectedTier, setSelectedTier] = useState<Record<OnslaughtAlliance, number | null>>(() => {
    const initial = {} as Record<OnslaughtAlliance, number | null>;
    for (const alliance of ALLIANCES) {
      const tiers = onslaughtBoards[alliance];
      initial[alliance] = tiers.length > 0 ? tiers[tiers.length - 1].tier : null;
    }
    return initial;
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 text-left">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ALLIANCES.map((alliance) => {
          const tiers = onslaughtBoards[alliance];
          const tier = selectedTier[alliance];
          const entry = tiers.find((t) => t.tier === tier);

          return (
            <div
              key={alliance}
              className="flex flex-col gap-2 rounded-lg border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-neutral-900/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{alliance}</span>
                <OnslaughtRankSelect
                  tiers={tiers}
                  value={tier ?? null}
                  onChange={(t) => setSelectedTier((s) => ({ ...s, [alliance]: t }))}
                />
              </div>
              {entry ? (
                <OnslaughtBoardMap key={entry.boardId} boardId={entry.boardId} />
              ) : (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {tiers.length > 0 ? "Select a rank to preview its map." : "No Onslaught data for this alliance yet."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import type { OnslaughtAlliance, OnslaughtBoards } from "../api/types";

const ONSLAUGHT_ALLIANCES: OnslaughtAlliance[] = ["Imperial", "Chaos", "Xenos"];

// `hero` is GET_PLAYER's player.hero. Each alliance's progress is tracked independently - a
// player can be further along against one alliance than another - and `battles[]` only contains
// tiers the player has actually encountered: once a rank's "X3" tier is beaten enough times, its
// 1-2 sub-tiers collapse away, leaving only a persistent "X3 challenge" entry (confirmed via a
// real capture: tiers 3/6/9/12 - Stone3/Iron3/Bronze3/Silver3 - present with no 1/2 siblings,
// while Gold/Diamond/Adamantine still had all of 13-21). Anything missing yields an empty list
// per alliance rather than throwing, matching extractSectorMap's convention.
export function extractOnslaughtBoards(hero: any): OnslaughtBoards {
  const tracking = hero?.progress?.onslaught?.progressTracking;
  const result = {} as OnslaughtBoards;
  for (const alliance of ONSLAUGHT_ALLIANCES) {
    const battles = tracking?.[alliance]?.battles ?? [];
    const entries = (battles as any[])
      .filter((battle) => typeof battle?.tier === "number" && typeof battle?.board?.boardId === "string")
      .map((battle) => ({ tier: battle.tier as number, boardId: battle.board.boardId as string }))
      .sort((a, b) => a.tier - b.tier);

    // A rank's own "3" tier (the last of its 3-tier group) is a collapsed/repeatable "challenge"
    // once its "1"/"2" siblings are no longer present in this alliance's own battle list -
    // confirmed via a real capture: Stone/Iron/Bronze/Silver had only their "3" tier present
    // (fully cleared), while Gold/Diamond/Adamantine still had all of 1/2/3 (still in progress).
    const tiers = new Set(entries.map((e) => e.tier));
    result[alliance] = entries.map((entry) => ({
      ...entry,
      isChallenge: entry.tier % 3 === 0 && !tiers.has(entry.tier - 1) && !tiers.has(entry.tier - 2),
    }));
  }
  return result;
}

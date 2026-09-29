import { useState } from "react";
import { Icon } from "./Icon";
import { factionIconUrl } from "../factions/faction-icon";
import type { FactionLeaderboardResult, LeaderboardBenchmark, SideLeaderboardResult } from "../api/types";

// Shared by the Crusade tab's table and card views - same underlying data, same rendering rules,
// just different layout containers around them.

export function FactionBadge({ factionId }: { factionId: string }) {
  const url = factionIconUrl(factionId);
  return url ? <Icon src={url} title={factionId} /> : <span>{factionId}</span>;
}

// Whole-number percent split, Imperium (for) always first - it's the number that matters when
// deciding whether to move to a planet. "-" when there's nothing to split yet (both 0/absent).
export function SidePercentCell({ pointsFor, pointsAgainst }: { pointsFor?: number; pointsAgainst?: number }) {
  const total = (pointsFor ?? 0) + (pointsAgainst ?? 0);
  if (total === 0) return <span>-</span>;
  const forPct = Math.round(((pointsFor ?? 0) / total) * 100);
  return (
    <span>
      {forPct}% / {100 - forPct}%
    </span>
  );
}

function percentileLabel(rank: number, numParticipants: number): string {
  return `top ${((rank / numParticipants) * 100).toFixed(1)}%`;
}

type RowKind = "row" | "me";

const ROW_CLASS: Record<RowKind, string> = {
  row: "text-neutral-500 dark:text-neutral-400",
  me: "font-semibold text-blue-600 dark:text-blue-400",
};

const TRIANGLE_BUTTON_CLASS =
  "self-start text-[10px] leading-none text-neutral-400 outline-none transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300";

// Shared by the collapsed (#1/#5/#10/#25) and expanded (full top 25 + rank+/-2) views: the
// player's own rank gets relabeled "You" in place when it lands on a row already there, or
// appended as its own row (in its correct numeric position) when it doesn't.
function buildRows(source: LeaderboardBenchmark[], myRank: number | null, myPoints: number | null) {
  const hasOwnRow = myRank !== null && myPoints !== null;
  const myRowAlreadyShown = hasOwnRow && source.some((r) => r.rank === myRank);
  return [
    ...source.map((r) => ({ ...r, kind: (hasOwnRow && r.rank === myRank ? "me" : "row") as RowKind })),
    ...(hasOwnRow && !myRowAlreadyShown ? [{ rank: myRank!, points: myPoints!, kind: "me" as RowKind }] : []),
  ]
    .map((r) => ({ ...r, label: r.kind === "me" ? `You (#${r.rank})` : `#${r.rank}` }))
    .sort((a, b) => a.rank - b.rank);
}

// Shared by both the Side and Faction Leaderboard columns - identical shape, identical rendering
// rules. Blank entirely when there's no leaderboard entry at all for this planet (a missing/
// wrong-prefix response, or - for the side leaderboard specifically - neither side having any
// entry) - not the same as "no personal rank", which still renders benchmarks (myRank === null
// below).
//
// Collapsed by default: just #1/#5/#10/#25, individually omitted when that rank doesn't exist -
// no filling in from other ranks, unlike the expanded view below. The disclosure triangle at the
// bottom switches to the expanded view - the full top 25 plus the player's own rank +/-2
// (nearMe, deduped against topEntries by rank since every rank maps to exactly one row) - and
// back again.
export function LeaderboardBreakdownCell({ result }: { result: SideLeaderboardResult | FactionLeaderboardResult | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!result) return null;

  const source = expanded
    ? [...result.topEntries, ...result.nearMe.filter((r) => !result.topEntries.some((t) => t.rank === r.rank))].sort((a, b) => a.rank - b.rank)
    : result.benchmarks;
  const rows = buildRows(source, result.myRank, result.myPoints);

  return (
    <div className="flex flex-col items-start gap-0.5">
      {result.myRank !== null ? (
        <>
          <span>
            #{result.myRank} / {result.numParticipants.toLocaleString()}
          </span>
          <span className="text-neutral-500 dark:text-neutral-400">{percentileLabel(result.myRank, result.numParticipants)}</span>
        </>
      ) : (
        <span>{result.numParticipants.toLocaleString()} participants</span>
      )}
      {rows.map((row) => (
        <span key={row.label} className={ROW_CLASS[row.kind]}>
          {row.label}: {row.points.toLocaleString()}
        </span>
      ))}
      <button
        type="button"
        aria-label={expanded ? "Collapse leaderboard" : "Expand leaderboard"}
        title={expanded ? "Collapse leaderboard" : "Expand leaderboard"}
        onClick={(e) => {
          // Both the Domination table row and card have their own onClick to open the sector map -
          // without this, toggling the triangle bubbles up and opens it too.
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        className={TRIANGLE_BUTTON_CLASS}
      >
        {expanded ? "▲" : "▼"}
      </button>
    </div>
  );
}

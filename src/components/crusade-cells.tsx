import { Icon } from "./Icon";
import { factionIconUrl } from "../factions/faction-icon";
import type { FactionLeaderboardResult, SideLeaderboardResult } from "../api/types";

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

type RowKind = "benchmark" | "me" | "reference";

const ROW_CLASS: Record<RowKind, string> = {
  benchmark: "text-neutral-500 dark:text-neutral-400",
  me: "font-semibold text-blue-600 dark:text-blue-400",
  reference: "font-semibold text-orange-600 dark:text-orange-400",
};

// Shared by both the Side and Faction Leaderboard columns - identical shape (numParticipants,
// myRank, myPoints, benchmarks, referenceScore), identical rendering rules. Blank entirely when
// there's no leaderboard entry at all for this planet (a missing/wrong-prefix response, or - for
// the side leaderboard specifically - neither side having any entry) - not the same as "no
// personal rank", which still renders benchmarks (myRank === null below).
export function LeaderboardBreakdownCell({ result }: { result: SideLeaderboardResult | FactionLeaderboardResult | null }) {
  if (!result) return null;
  // The top-10%/#25 figure - shown on both Side and Faction (planet sort order is still driven
  // by the Faction one specifically, see CrusadeTab's activePlanets sort). Skipped when its rank
  // is already one of the standard benchmarks (e.g. the #25 fallback case) to avoid showing the
  // same rank/score twice.
  const referenceScore = result.referenceScore;
  const showReference = referenceScore !== null && !result.benchmarks.some((b) => b.rank === referenceScore.rank);

  const baseRows: { rank: number; points: number; kind: RowKind }[] = [
    ...result.benchmarks.map((b) => ({ rank: b.rank, points: b.points, kind: "benchmark" as const })),
    ...(showReference ? [{ rank: referenceScore.rank, points: referenceScore.points, kind: "reference" as const }] : []),
  ];

  // When the player's own rank lands exactly on a benchmark/reference rank (most commonly #1),
  // that row is relabeled as "me" in place rather than getting a separate, duplicate-valued "You"
  // row alongside it - a plain "#1: X" row otherwise gives no indication that X is the player.
  const { myRank, myPoints } = result;
  const hasOwnRow = myRank !== null && myPoints !== null;
  const myRowAlreadyShown = hasOwnRow && baseRows.some((r) => r.rank === myRank);

  // Rank-ascending (#1 first, #25 last) - the "You" row's sort key is the player's actual rank,
  // so it lands in its correct numeric position among the benchmarks (e.g. between #10 and #25).
  const rows = [
    ...baseRows.map((r) => (hasOwnRow && r.rank === myRank ? { ...r, kind: "me" as const } : r)),
    ...(hasOwnRow && !myRowAlreadyShown ? [{ rank: myRank, points: myPoints, kind: "me" as const }] : []),
  ]
    .map((r) => ({ ...r, label: r.kind === "me" ? `You (#${r.rank})` : r.kind === "reference" ? `#${r.rank} (top 10%)` : `#${r.rank}` }))
    .sort((a, b) => a.rank - b.rank);

  return (
    <div className="flex flex-col gap-0.5">
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
    </div>
  );
}

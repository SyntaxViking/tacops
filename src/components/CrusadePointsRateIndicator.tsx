import { formatCompactSignedPoints } from "../crusade/planet-tracker-view-model";

interface CrusadePointsRateIndicatorProps {
  // Map-wide points/hour aggregate for each side (see computeTotalHourlyRate) - needs per-planet
  // history to compute, so this is dev-mode-only (App.tsx); AnonymousCrusadeSection has no
  // per-planet history fetched (only the public crusade-cache snapshot) and never rendered this.
  imperialRate: number;
  devastationRate: number;
}

// Mirrors BuildTimestamp's fixed top-left corner, on the opposite (right) side. Was previously
// bundled with a leaderboard-derived "Ranked Participants" headcount (RankedParticipantsCounter) -
// split out on its own since that headcount can no longer be cheaply populated once the poller
// stopped bulk-fetching leaderboard data, while this points-rate figure is unrelated (derived
// purely from GET_CRUSADE's own point totals) and has nothing to do with leaderboard fetching.
export function CrusadePointsRateIndicator({ imperialRate, devastationRate }: CrusadePointsRateIndicatorProps) {
  return (
    <span className="fixed right-1 top-1 text-xs text-neutral-400 dark:text-neutral-500">
      Points/hour:{" "}
      <span className="text-blue-600 dark:text-blue-400">{formatCompactSignedPoints(imperialRate)}</span>
      {" / "}
      <span className="text-red-600 dark:text-red-400">{formatCompactSignedPoints(devastationRate)}</span>
    </span>
  );
}

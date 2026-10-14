import { formatCompactSignedPoints } from "../crusade/planet-tracker-view-model";

interface RankedParticipantsCounterProps {
  imperial: number;
  devastation: number;
  // Map-wide points/hour aggregate for each side (see computeTotalHourlyRate), shown in parens
  // right after each side's headcount. Optional - AnonymousCrusadeSection has no per-planet
  // history fetched (it only has the public crusade-cache snapshot), so it omits these and the
  // parens are simply left off there rather than showing a misleading "(+0)".
  imperialRate?: number;
  devastationRate?: number;
}

// Mirrors BuildTimestamp's fixed top-left corner, on the opposite (right) side.
export function RankedParticipantsCounter({ imperial, devastation, imperialRate, devastationRate }: RankedParticipantsCounterProps) {
  return (
    <span className="fixed right-1 top-1 text-xs text-neutral-400 dark:text-neutral-500">
      Ranked Participants:{" "}
      <span className="text-blue-600 dark:text-blue-400">
        {imperial.toLocaleString()}
        {imperialRate !== undefined && `(${formatCompactSignedPoints(imperialRate)})`}
      </span>
      {" / "}
      <span className="text-red-600 dark:text-red-400">
        {devastation.toLocaleString()}
        {devastationRate !== undefined && `(${formatCompactSignedPoints(devastationRate)})`}
      </span>
    </span>
  );
}

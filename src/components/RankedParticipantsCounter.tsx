interface RankedParticipantsCounterProps {
  imperial: number;
  devastation: number;
}

// Mirrors BuildTimestamp's fixed top-left corner, on the opposite (right) side.
export function RankedParticipantsCounter({ imperial, devastation }: RankedParticipantsCounterProps) {
  return (
    <span className="fixed right-1 top-1 text-xs text-neutral-400 dark:text-neutral-500">
      Ranked Participants: <span className="text-blue-600 dark:text-blue-400">{imperial.toLocaleString()}</span>
      {" / "}
      <span className="text-red-600 dark:text-red-400">{devastation.toLocaleString()}</span>
    </span>
  );
}

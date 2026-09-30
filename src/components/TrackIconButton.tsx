interface TrackIconButtonProps {
  isTracked: boolean;
  onToggle: () => void;
  // Set when this button can't be used right now (either a different planet is tracked, or this
  // one isn't currently trackable - see isTrackDisabled/isPlanetTrackable). The currently-tracked
  // planet's own button is never disabled, so it can always be untracked.
  disabled?: boolean;
  // Full tooltip text while disabled - the caller knows *why* (a different planet is tracked vs.
  // this planet just isn't available to track), so it composes the message rather than this
  // component guessing from a single reason.
  disabledTitle?: string;
  size?: number;
}

// Same inline-SVG-button shape as StarIconButton (aria-disabled + stopPropagation, since this sits
// inside rows/cards that have their own onClick to open the sector map) - a small radar/target
// glyph rather than a star, filled while tracking.
export function TrackIconButton({ isTracked, onToggle, disabled = false, disabledTitle, size = 18 }: TrackIconButtonProps) {
  return (
    <button
      type="button"
      aria-disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      title={disabled ? (disabledTitle ?? "Not available to track") : isTracked ? "Untrack this planet" : "Track this planet's capture race"}
      className={`inline-flex shrink-0 items-center justify-center outline-none transition-colors ${
        disabled
          ? "cursor-not-allowed text-neutral-300 dark:text-neutral-600"
          : isTracked
            ? "text-emerald-500 hover:text-emerald-600"
            : "text-neutral-400 hover:text-emerald-500 dark:text-neutral-500 dark:hover:text-emerald-400"
      }`}
      style={{ height: size, width: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={12} cy={12} r={9} fill={isTracked ? "currentColor" : "none"} fillOpacity={isTracked ? 0.25 : 0} />
        <circle cx={12} cy={12} r={9} />
        <circle cx={12} cy={12} r={2.5} fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}

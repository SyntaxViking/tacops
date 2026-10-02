interface TrackIconButtonProps {
  isTracked: boolean;
  onToggle: () => void;
  // Set when this button can't be used right now - this planet isn't currently trackable (already
  // captured or in cooldown) and isn't the one currently tracked - see isTrackDisabled/
  // isPlanetTrackable. The currently-tracked planet's own button is never disabled, so it can
  // always be untracked.
  disabled?: boolean;
  // Tooltip text while disabled.
  disabledTitle?: string;
  // Name of whatever planet is tracked right now, if it's a different one than this button's own
  // planet - surfaced in the enabled tooltip so clicking a different, trackable planet clearly
  // reads as "switch tracking to this one" rather than silently stealing the slot.
  otherTrackedPlanetName?: string;
  size?: number;
}

// Same inline-SVG-button shape as StarIconButton (aria-disabled + stopPropagation, since this sits
// inside rows/cards that have their own onClick to open the sector map) - a small radar/target
// glyph rather than a star, filled while tracking.
export function TrackIconButton({
  isTracked,
  onToggle,
  disabled = false,
  disabledTitle,
  otherTrackedPlanetName,
  size = 18,
}: TrackIconButtonProps) {
  const title = disabled
    ? (disabledTitle ?? "Not available to track")
    : isTracked
      ? "Untrack this planet"
      : otherTrackedPlanetName
        ? `Track this planet (stops tracking ${otherTrackedPlanetName})`
        : "Track this planet's capture race";
  return (
    <button
      type="button"
      aria-disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      title={title}
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

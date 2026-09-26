import { MAX_STARRED_PLANETS } from "../crusade/starred-planets";

interface StarIconButtonProps {
  isFavorited: boolean;
  onToggle: () => void;
  // Set when the starred-planet cap is reached and this one isn't starred (see isStarDisabled) -
  // an already-starred button is never disabled, so it can always be un-starred.
  disabled?: boolean;
  size?: number;
}

// Same inline-SVG-button approach as RefreshIconButton, including the stopPropagation - this sits
// inside rows/cards that have their own onClick (e.g. to open the sector map modal).
export function StarIconButton({ isFavorited, onToggle, disabled = false, size = 18 }: StarIconButtonProps) {
  return (
    <button
      type="button"
      // aria-disabled (not the native attribute): a natively disabled button can let the click fall
      // through to the enclosing card's own onClick in some browsers; this always swallows it.
      aria-disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      title={disabled ? `You can star at most ${MAX_STARRED_PLANETS} planets - un-star one first` : isFavorited ? "Remove from favorites" : "Add to favorites"}
      className={`inline-flex shrink-0 items-center justify-center outline-none transition-colors ${
        disabled
          ? "cursor-not-allowed text-neutral-300 dark:text-neutral-600"
          : isFavorited
            ? "text-amber-400 hover:text-amber-500"
            : "text-neutral-400 hover:text-amber-400 dark:text-neutral-500 dark:hover:text-amber-400"
      }`}
      style={{ height: size, width: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill={isFavorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}

interface ThumbsDownIconButtonProps {
  isAntiFavorited: boolean;
  onToggle: () => void;
  size?: number;
}

// Same inline-SVG-button approach as StarIconButton/RefreshIconButton, including the
// stopPropagation for rows/cards that have their own onClick.
export function ThumbsDownIconButton({ isAntiFavorited, onToggle, size = 18 }: ThumbsDownIconButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={isAntiFavorited ? "Remove from deprioritized" : "Deprioritize for operations"}
      className={`inline-flex shrink-0 items-center justify-center outline-none transition-colors ${
        isAntiFavorited ? "text-red-500 hover:text-red-600" : "text-neutral-400 hover:text-red-400 dark:text-neutral-500 dark:hover:text-red-400"
      }`}
      style={{ height: size, width: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill={isAntiFavorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 14V2" />
        <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
      </svg>
    </button>
  );
}

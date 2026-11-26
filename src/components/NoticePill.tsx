interface NoticePillProps {
  message: string;
  onDismiss: () => void;
}

// A pill-shaped, non-blocking notice pinned to the top of the screen. Unlike Toast it stays until
// the user dismisses it (the ✕ or a click on the pill), since it's something they should act on
// rather than a quick confirmation - and it doesn't cover any content or intercept anything else.
export function NoticePill({ message, onDismiss }: NoticePillProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      <div
        role="status"
        onClick={onDismiss}
        className="pointer-events-auto flex max-w-full cursor-pointer items-center gap-2 rounded-full bg-amber-100 px-4 py-2 text-sm text-amber-900 shadow-lg dark:bg-amber-900 dark:text-amber-100"
      >
        <span>{message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="shrink-0 cursor-pointer font-bold leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

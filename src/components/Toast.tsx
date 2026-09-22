import { useEffect } from "react";

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 1500;

// Fixed-position floaty, auto-dismissing after AUTO_DISMISS_MS or on click. Depends only on
// `message` (not `onDismiss`) so an unrelated parent re-render (e.g. the Crusade auto-refresh
// scheduler ticking) can't keep resetting the timer with a freshly-identical-but-new callback.
export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onDismiss();
      }}
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg transition-opacity dark:bg-neutral-100 dark:text-neutral-900"
    >
      {message}
    </div>
  );
}

// Shown once startVersionCheck (src/version-check.ts) detects a newer build has deployed - not
// dismissible by design (the whole point is forcing the reload, not letting someone keep running
// stale client logic), but clickable to reload immediately instead of waiting out the countdown.
export function StaleVersionBanner({ onReloadNow }: { onReloadNow: () => void }) {
  return (
    <div
      onClick={onReloadNow}
      role="alert"
      className="fixed inset-x-0 top-0 z-50 cursor-pointer bg-amber-500 px-4 py-2 text-center text-sm font-medium text-neutral-900"
    >
      A new version is available - refreshing the page... (click to refresh now)
    </div>
  );
}

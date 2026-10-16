// Military time (no AM/PM, always 4 digits) plus date, since several of these timestamps land
// far enough out that they routinely fall on a different calendar day.
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  const date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const time = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

// Second-accurate, with a local timezone abbreviation - for "exactly when was this read" displays
// (unlike formatDateTime above, which is minute-accurate and timezone-less). Intl supplies both
// the seconds formatting and the tz abbreviation, rather than hand-rolling either.
export function formatDateTimeWithSeconds(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date(epochMs));
}

// Staleness display for "how long since we last successfully polled this" (PlanetFetchTimestamp) -
// always at least mm:ss (zero-padded), with an unpadded hh: prefix once elapsed time reaches an
// hour. Unlike planet-tracker-view-model.ts's formatElapsedSeconds (which shows a bare "45s" under
// a minute, for a graph's tick labels), this never drops to a bare-seconds form - mm:ss is the
// floor, matching a conventional stopwatch display.
export function formatStaleness(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

const DEFAULT_CLASS = "text-neutral-500 dark:text-neutral-400";

// Urgency tiers for a deadline-style timestamp (a cap being reached, a raid token about to burn):
// default color if it's more than an hour out, amber within an hour, orange within five minutes,
// red once it's arrived or passed.
export function urgencyColorClass(atMs: number, now: number = Date.now()): string {
  const remainingMs = atMs - now;
  if (remainingMs <= 0) return "text-red-600 dark:text-red-400";
  if (remainingMs <= 5 * 60 * 1000) return "text-orange-600 dark:text-orange-400";
  if (remainingMs <= 60 * 60 * 1000) return "text-amber-600 dark:text-amber-400";
  return DEFAULT_CLASS;
}

export { DEFAULT_CLASS as DEFAULT_SUBTEXT_CLASS };

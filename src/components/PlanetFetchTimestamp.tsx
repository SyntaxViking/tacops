import { useEffect, useState } from "react";
import { formatStaleness } from "../format-date-time";
import type { PlanetRefreshEntry } from "../api/types";

// Shared by the Crusades tab's cards and table. Shows how long it's been since the last
// successful fetch, ticking live every second. A failed attempt in between doesn't reset or
// otherwise change this display - it just keeps counting up until the next success, with no
// separate failure indicator (per product decision, an ever-increasing staleness counter is
// enough signal on its own).
export function PlanetFetchTimestamp({ entry }: { entry: PlanetRefreshEntry }) {
  const textClass = "text-xs text-neutral-500 dark:text-neutral-400";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (entry.lastSuccessAt === null) {
    return <span className={textClass}>Not yet loaded</span>;
  }

  return <span className={textClass}>{formatStaleness(now - entry.lastSuccessAt)}</span>;
}

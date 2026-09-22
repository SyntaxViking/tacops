import { sha256Hex } from "./api/sha256";
import type { Environment } from "./api/types";

// Privacy-preserving usage tracking: only a SHA-256 hash of userId ever leaves the browser for
// this, never the raw id. QA/dev traffic is excluded so it doesn't pollute real usage numbers.
// Best-effort - a tracking failure must never affect the actual data fetch, so this swallows errors.
export async function trackUsage(userId: string, environment: Environment): Promise<void> {
  if (environment !== "prod") return;
  try {
    const userHash = await sha256Hex(userId);
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userHash }),
    });
  } catch {
    // best-effort, see above
  }
}

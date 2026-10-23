// Fetches the background poller's shared leaderboard cache (worker/poller.ts, served by
// worker/leaderboard-cache.ts) - used by App.tsx's go() for a logged-in user's fast-paint
// bootstrap and by its ~1-minute freshness-poll loop, same structural pattern as
// fetch-crusade-cache.ts. GET with no body, so this has its own small timeout wrapper rather than
// reusing fetch-with-timeout.ts's POST-only one.
import { proxyWorkerGet, shouldUseProductionDataSource } from "./dev-data-source";
import type { SharedPlanetLeaderboard } from "./types";

export interface LeaderboardCacheResponse {
  entries: Record<string, SharedPlanetLeaderboard>;
}

const TIMEOUT_MS = 20_000;
const PATH = "/api/leaderboard-cache";

export async function fetchLeaderboardCache(): Promise<LeaderboardCacheResponse> {
  if (shouldUseProductionDataSource()) {
    return proxyWorkerGet<LeaderboardCacheResponse>(PATH, TIMEOUT_MS);
  }
  const res = await Promise.race([
    fetch(PATH),
    new Promise<Response>((_, reject) => {
      setTimeout(() => reject(new Error(`"${PATH}" timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
    }),
  ]);
  if (!res.ok) {
    throw new Error(`"${PATH}" returned HTTP ${res.status}`);
  }
  return (await res.json()) as LeaderboardCacheResponse;
}

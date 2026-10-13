// Fetches the background poller's cache (worker/poller.ts, served by worker/crusade-cache.ts) -
// used both by AnonymousCrusadeSection (the only data an anonymous visitor ever gets) and by
// App.tsx's go() for a logged-in user's fast-paint bootstrap. GET with no body, unlike this
// codebase's other /api/fetch-* calls (fetch-with-timeout.ts's fetchWithTimeout is POST-only), so
// this has its own small timeout wrapper instead of reusing that one.
import { proxyWorkerGet, shouldUseProductionDataSource } from "./dev-data-source";

export interface CrusadeCacheResponse {
  crusadeRaw: unknown | null;
  crusadeFetchedAt: number | null;
  leaderboards: Record<string, { raw: unknown; fetchedAt: number }>;
}

const TIMEOUT_MS = 20_000;
const PATH = "/api/crusade-cache";

export async function fetchCrusadeCache(): Promise<CrusadeCacheResponse> {
  if (shouldUseProductionDataSource()) {
    return proxyWorkerGet<CrusadeCacheResponse>(PATH, TIMEOUT_MS);
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
  return (await res.json()) as CrusadeCacheResponse;
}

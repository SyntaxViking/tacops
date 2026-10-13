// Fetches one planet's accumulated points-remaining history (worker/poller.ts writes it on its
// existing ~5-minute crusade-refresh cadence, served by worker/planet-history.ts) - used to seed a
// freshly-tracked planet's graph with everything recorded since the current capture cycle began,
// not just the window the user happens to be watching. GET with no body, same reasoning as
// fetch-crusade-cache.ts for the small standalone timeout wrapper instead of fetch-with-timeout.ts
// (that one's POST-only).
import { proxyWorkerGet, shouldUseProductionDataSource } from "./dev-data-source";
import type { TrackedPlanetSample } from "../crusade/planet-tracker-view-model";

const TIMEOUT_MS = 20_000;

// Best-effort: resolves to [] rather than throwing on any failure (network error, timeout, bad
// response) - a missing/failed history seed shouldn't block or break tracking, which already works
// fine starting from empty, exactly as it did before this feature existed.
export async function fetchPlanetHistory(planetId: string): Promise<TrackedPlanetSample[]> {
  const path = `/api/planet-history?planetId=${encodeURIComponent(planetId)}`;
  try {
    const data = shouldUseProductionDataSource()
      ? await proxyWorkerGet<{ samples: TrackedPlanetSample[] }>(path, TIMEOUT_MS)
      : await (async () => {
          const res = await Promise.race([
            fetch(path),
            new Promise<Response>((_, reject) => {
              setTimeout(() => reject(new Error(`"${path}" timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
            }),
          ]);
          if (!res.ok) throw new Error(`"${path}" returned HTTP ${res.status}`);
          return (await res.json()) as { samples: TrackedPlanetSample[] };
        })();
    return data.samples ?? [];
  } catch (error) {
    console.error(`[fetchPlanetHistory] failed for ${planetId}`, error);
    return [];
  }
}

// Bulk variant of fetchPlanetHistory above - every planet's history in one request instead of one
// per planet, used by the Monitor tab (src/components/MonitorTab.tsx) to show every planet's graph
// at once. Same best-effort semantics: resolves to an empty Map on any failure.
export async function fetchAllPlanetHistory(): Promise<Map<string, TrackedPlanetSample[]>> {
  const path = "/api/planet-history-all";
  try {
    const data = shouldUseProductionDataSource()
      ? await proxyWorkerGet<{ samples: Record<string, TrackedPlanetSample[]> }>(path, TIMEOUT_MS)
      : await (async () => {
          const res = await Promise.race([
            fetch(path),
            new Promise<Response>((_, reject) => {
              setTimeout(() => reject(new Error(`"${path}" timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
            }),
          ]);
          if (!res.ok) throw new Error(`"${path}" returned HTTP ${res.status}`);
          return (await res.json()) as { samples: Record<string, TrackedPlanetSample[]> };
        })();
    return new Map(Object.entries(data.samples ?? {}));
  } catch (error) {
    console.error("[fetchAllPlanetHistory] failed", error);
    return new Map();
  }
}

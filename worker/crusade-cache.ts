// Serves the poller's crusade snapshot (worker/poller.ts) to the frontend. Thin passthrough, no
// reshaping - this endpoint's job is just to hand back the same raw shape a live GET_CRUSADE call
// would have produced, sourced from D1 instead of Loki. Leaderboard data is served by a separate
// endpoint instead (GET /api/leaderboard-cache, worker/leaderboard-cache.ts) - see AGENTS.md.
export interface CrusadeCacheResponse {
  crusadeRaw: unknown | null;
  crusadeFetchedAt: number | null;
}

interface SnapshotRow {
  raw_response: string;
  fetched_at: number;
}

export async function getCrusadeCache(db: D1Database): Promise<CrusadeCacheResponse> {
  const snapshotRow = await db.prepare("SELECT raw_response, fetched_at FROM crusade_snapshot_cache WHERE id = 1").first<SnapshotRow>();

  return {
    crusadeRaw: snapshotRow ? JSON.parse(snapshotRow.raw_response) : null,
    crusadeFetchedAt: snapshotRow?.fetched_at ?? null,
  };
}

// Serves the poller's cache (worker/poller.ts) to the frontend. Thin passthrough, no reshaping -
// this endpoint's job is just to hand back the same raw shapes a live GET_CRUSADE/
// GET_LEADERBOARD_2 call would have produced, sourced from D1 instead of Loki. The one reshape
// this feature does anywhere happens client-side, in src/api/crusade-cache-seed.ts, reusing
// src/api/fetch-crusade-data.ts's existing parsing logic.
export interface CrusadeCacheResponse {
  crusadeRaw: unknown | null;
  crusadeFetchedAt: number | null;
  leaderboards: Record<string, { raw: unknown; fetchedAt: number }>;
}

interface SnapshotRow {
  raw_response: string;
  fetched_at: number;
}

interface PlanetRow {
  planet_id: string;
  raw_leaderboards: string;
  fetched_at: number;
}

export async function getCrusadeCache(db: D1Database): Promise<CrusadeCacheResponse> {
  const [snapshotRow, planetRows] = await Promise.all([
    db.prepare("SELECT raw_response, fetched_at FROM crusade_snapshot_cache WHERE id = 1").first<SnapshotRow>(),
    db.prepare("SELECT planet_id, raw_leaderboards, fetched_at FROM planet_leaderboard_cache").all<PlanetRow>(),
  ]);

  const leaderboards: Record<string, { raw: unknown; fetchedAt: number }> = {};
  for (const row of planetRows.results ?? []) {
    leaderboards[row.planet_id] = { raw: JSON.parse(row.raw_leaderboards), fetchedAt: row.fetched_at };
  }

  return {
    crusadeRaw: snapshotRow ? JSON.parse(snapshotRow.raw_response) : null,
    crusadeFetchedAt: snapshotRow?.fetched_at ?? null,
    leaderboards,
  };
}

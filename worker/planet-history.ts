// Persists a rolling, append-only points-remaining history for every Domination planet, written by
// the poller (worker/poller.ts) on its existing once-every-5-minutes crusade-refresh cadence - see
// migrations/0009_planet_history_buckets.sql. Read back by GET /api/planet-history (one planet) and
// GET /api/planet-history-all (every planet, for the Monitor tab) in worker/index.ts, to seed a
// freshly-tracked planet's graph (src/App.tsx) and Monitor's graphs with everything recorded since
// the current capture cycle began, not just the window the user happened to be watching.
//
// One row per PLANETS_PER_BUCKET-sized bucket of planets (planet_history_buckets), not one row per
// planet (planet_history_cache, migrations/0007 - left in place, unused, as a safety net, same
// precedent as that migration's own predecessor tables). A 146-planet Domination map meant up to
// 146 row-writes every 5-minute cycle with the old one-row-per-planet design - even after removing
// the per-planet leaderboard fetch and poller_planet_queue (see AGENTS.md), that alone was still
// enough D1 write-row volume to threaten the daily quota, and the problem doesn't shrink just
// because fewer planets happen to have changed that cycle (a fully-contested map changes most of
// them every time). Bucketing fixes this at the root: write volume becomes a flat function of
// bucket COUNT (NUM_BUCKETS writes every cycle, always), never of how many planets or how much
// contention there is. See buildBucketAssignments/buildBucketUpsertStatements below, and
// migrations/0009's own comment for the exact size math behind PLANETS_PER_BUCKET = 8.
//
// A single bucket row growing forever just moves the same unbounded-growth problem somewhere else,
// though: real production data had a planet with 1400+ samples after 11 days of a stalemate, and
// every write re-parses/re-serializes the WHOLE bucket (not just one planet's array) - cost that
// scales with how long every era in that bucket has run. compressHistorySamples (lossless run
// collapsing, then a 5-minute floor on older samples, then a hard ~999-sample ceiling, applied on
// every append in appendToHistoryCache) keeps each PLANET's own array bounded regardless of era
// length - see each function's own comment for the exact rules - which is what keeps a bucket's
// total size bounded too (PLANETS_PER_BUCKET * ~999-sample worst case, sized to stay comfortably
// under D1's 2MB row limit - see migrations/0009). This per-planet compression was itself a real
// contributor to a ~7-hour stretch on 2026-10-12 where 408 of 430 scheduled poller ticks failed
// with status: exceededResources (the CPU-limit hard-kill) - see worker/poller.ts's own top-of-file
// comment for the other half of that fix (the checkpointed step/lock redesign, migrations/0008).
//
// pointsRemaining/isDominationSunk are reused as-is from src/crusade/crusade-domination-view-model.ts
// (confirmed Tauri/browser-free - its only import is the plain-interface src/api/types.ts), the same
// class of precedent as this worker already importing src/factions/faction-side.ts and
// src/assets/seasons' planet-data.json. rawPlanetToCrusadePlanet below is a small hand-written duplicate of
// src/api/fetch-crusade-data.ts's mapCrusadeResponseData per-planet mapping, following the exact
// precedent worker/poller.ts already set by duplicating findActivePhase rather than importing that
// file (which pulls in @tauri-apps/api/core).
import { getPlanetData } from "../src/assets/seasons";
import { computeConquestProgress, isDominationSunk, pointsRemaining } from "../src/crusade/crusade-domination-view-model";
import { activeSeason, type Season } from "../src/season";
import type { CrusadePlanet } from "../src/api/types";

export interface PlanetHistorySample {
  atMs: number;
  imperialRemaining: number;
  devastationRemaining: number;
  // Raw accrued points and raw capture threshold at this moment, recorded alongside the legacy
  // *Remaining fields above starting 2026-10-13 - optional because older already-stored samples
  // won't have them. See src/crusade/planet-tracker-view-model.ts's TrackedPlanetSample (the
  // client-side mirror of this same shape) for the full rationale.
  // TODO(2026-10-20): the current Domination season ends 2026-10-17 - once that's passed, every
  // live era's history will have been recorded entirely after this change, so these can become
  // required and imperialRemaining/devastationRemaining can be deleted outright.
  imperialAccrued?: number;
  devastationAccrued?: number;
  imperialThreshold?: number;
  devastationThreshold?: number;
}

// Maps one raw planetsData[] entry (GET_CRUSADE's own shape, already in memory in worker/poller.ts
// during a crusade-refresh tick) into the CrusadePlanet shape pointsRemaining/isDominationSunk need.
// name/zone are never read by either of those, so cheap placeholders stand in rather than pulling in
// planet-data.json's name/zone lookup just for this.
export function rawPlanetToCrusadePlanet(raw: {
  planetId: string;
  sideOwner?: string;
  ownedByFaction?: string;
  pointsFor?: number;
  pointsAgainst?: number;
  struggleData?: CrusadePlanet["struggleData"];
}): CrusadePlanet {
  return {
    planetId: raw.planetId,
    name: raw.planetId,
    zone: null,
    sideOwner: raw.sideOwner,
    ownedByFaction: raw.ownedByFaction,
    pointsFor: raw.pointsFor,
    pointsAgainst: raw.pointsAgainst,
    struggleData: raw.struggleData,
  };
}

export interface PlanetHistoryRow {
  planetId: string;
  atMs: number;
  imperialRemaining: number;
  devastationRemaining: number;
  imperialAccrued?: number;
  devastationAccrued?: number;
  imperialThreshold?: number;
  devastationThreshold?: number;
  sunk: boolean;
}

// Pure: what to write for one planet at this tick. Only ever called on planets already filtered to
// struggleData != null (the caller's job - see worker/poller.ts), so pointsRemaining never returns
// Infinity here in practice (and computeConquestProgress never returns null here either).
// TODO(2026-10-20): stop writing imperialRemaining/devastationRemaining once the season ending
// 2026-10-17 is over - see PlanetHistorySample's own comment.
export function buildHistoryRow(planet: CrusadePlanet, atMs: number): PlanetHistoryRow {
  const remaining = pointsRemaining(planet);
  const progress = computeConquestProgress(planet);
  return {
    planetId: planet.planetId,
    atMs,
    imperialRemaining: remaining.imperial,
    devastationRemaining: remaining.devastation,
    imperialAccrued: progress?.imperialCurrent,
    devastationAccrued: progress?.devastationCurrent,
    imperialThreshold: progress?.imperialThreshold,
    devastationThreshold: progress?.devastationThreshold,
    sunk: isDominationSunk(planet),
  };
}

// True only the instant a planet flips from sunk (captured/in cooldown) back to trackable - that's
// the one moment its history should be cleared and a new capture-cycle "era" begins. `null` means
// no prior history row exists yet for this planet (never clear something that isn't there).
export function isEraReset(lastKnownSunk: boolean | null, currentlySunk: boolean): boolean {
  return lastKnownSunk === true && currentlySunk === false;
}

export interface HistoryCacheEntry {
  samples: PlanetHistorySample[];
  lastSunk: boolean;
}

// Belt-and-suspenders companion to isEraReset: that resets on the game's own sunk flag flipping
// true -> false, read once per tick. This reaches the same conclusion directly from the stored
// values themselves - the moment either side's remaining crosses from <= 0 back to positive, a
// side has just been captured.
//
// That crossing itself is NOT where the new era's meaningful history should start, though:
// crusade-domination-view-model.ts's isInDominationCooldown treats pointsFor/pointsAgainst both
// being 0 as cooldown, and pointsRemaining is threshold - current - so the instant a side is
// captured, GET_CRUSADE resets its points to 0 and remaining snaps straight back up to that side's
// full, unmet threshold (a large positive number). That same snapped-back value then sits there
// completely unchanged through the ENTIRE cooldown, and for however much longer the planet stays
// uncontested after reopening - so truncating at the crossing alone still leaves a dead stretch
// (collapsed to 2 points, but weeks apart) dominating the chart's elapsed-time axis and squeezing
// any real subsequent activity into an unreadable sliver. A genuine DECREASE (either side's
// remaining actually going down relative to the sample before it - real attack progress, not a
// defender's powerup pushing it up, which can happen even while fully uncontested and should stay
// visible once the timeline has genuinely started) is what actually marks something worth
// charting - so this truncates to the first such decrease after the last reopen, dropping the
// reopen crossing itself along with everything in the dead stretch before that decrease. Falls
// back to the reopen crossing if no decrease has happened yet (nothing better to anchor to).
//
// Finds the reopen by scanning backward from the end, rather than forward while tracking the last
// match seen - both find the same (last) reopen, but this runs on every single append, and the
// array it's given is always "whatever survived this same function last time, plus one new
// sample" - so in steady state the most recent transition (if any) is right at the end, and
// backward scanning finds it in O(1) instead of walking the whole array every time.
export function truncateAtLastReopen(samples: readonly PlanetHistorySample[]): PlanetHistorySample[] {
  let reopenIndex = -1;
  for (let i = samples.length - 1; i > 0; i--) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const reopened = (prev.imperialRemaining <= 0 && curr.imperialRemaining > 0) || (prev.devastationRemaining <= 0 && curr.devastationRemaining > 0);
    if (reopened) {
      reopenIndex = i;
      break;
    }
  }
  if (reopenIndex === -1) return [...samples];

  for (let i = reopenIndex + 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const decreased = curr.imperialRemaining < prev.imperialRemaining || curr.devastationRemaining < prev.devastationRemaining;
    if (decreased) return samples.slice(i);
  }
  return samples.slice(reopenIndex);
}

// Lossless: collapses any maximal run of consecutive samples sharing the exact same
// (imperialRemaining, devastationRemaining) down to just that run's first and last sample. Visually
// lossless - a flat segment on the chart renders identically whether it's backed by 2 points or
// 200, since nothing drawn in between ever differs - but it's the single biggest win for a planet
// that's gone fully static (a stalemate, nobody fighting over it): real production data had planets
// with 1400+ samples, every one identical, after 11 days of a stalemate. This collapses that down
// to 2 on the very next write, regardless of how long the stalemate continues.
export function collapseIdenticalRuns(samples: readonly PlanetHistorySample[]): PlanetHistorySample[] {
  const result: PlanetHistorySample[] = [];
  let i = 0;
  while (i < samples.length) {
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].imperialRemaining === samples[i].imperialRemaining && samples[j + 1].devastationRemaining === samples[i].devastationRemaining) {
      j++;
    }
    result.push(samples[i]);
    if (j !== i) result.push(samples[j]);
    i = j + 1;
  }
  return result;
}

const MIN_SAMPLE_SPACING_MS = 5 * 60 * 1000;
export const RECENT_SAMPLES_KEPT_DENSE = 10;

// Lossy: once there are more than RECENT_SAMPLES_KEPT_DENSE samples, everything except that many
// most-recent ones gets thinned so no two consecutive *kept* older samples are closer than
// MIN_SAMPLE_SPACING_MS apart - older history only needs enough resolution to show the overall
// trend, while the chart's live/recent edge stays at full resolution. Applied after
// collapseIdenticalRuns, on whatever survives that pass.
export function thinOlderSamples(samples: readonly PlanetHistorySample[]): PlanetHistorySample[] {
  if (samples.length <= RECENT_SAMPLES_KEPT_DENSE) return [...samples];
  const splitIndex = samples.length - RECENT_SAMPLES_KEPT_DENSE;
  const older = samples.slice(0, splitIndex);
  const recent = samples.slice(splitIndex);

  const thinnedOlder: PlanetHistorySample[] = [older[0]];
  for (let i = 1; i < older.length; i++) {
    if (older[i].atMs - thinnedOlder[thinnedOlder.length - 1].atMs >= MIN_SAMPLE_SPACING_MS) {
      thinnedOlder.push(older[i]);
    }
  }
  return [...thinnedOlder, ...recent];
}

const HARD_CAP_SAMPLES = 999;

// A capture: either side's remaining crosses from positive to <= 0 relative to the previous
// sample - the moment that side actually got captured, as opposed to a reopen (<= 0 back to
// positive), which can't appear mid-array by the time this runs - see enforceHardCap's own comment.
function isCaptureTransition(prev: PlanetHistorySample, curr: PlanetHistorySample): boolean {
  return (prev.imperialRemaining > 0 && curr.imperialRemaining <= 0) || (prev.devastationRemaining > 0 && curr.devastationRemaining <= 0);
}

// Hard ceiling, applied after the passes above: once a planet's history is still over
// HARD_CAP_SAMPLES samples even after truncation + lossless + lossy compression, roughly halve it -
// but never drop a capture moment (see isCaptureTransition - these matter more than routine
// progress points) or any of the most-recent RECENT_SAMPLES_KEPT_DENSE samples. The opposite
// direction (<= 0 back to positive, a reopen) can't appear as an INTERNAL transition here at all -
// truncateAtLastReopen already either dropped it entirely (a decrease was found after it) or left
// it as this array's own starting point (no decrease yet), never anywhere in the middle. This is a
// self-maintaining bound, not a one-time cut: the array keeps growing back toward the cap and halving again
// indefinitely, so it never exceeds roughly HARD_CAP_SAMPLES in the long run regardless of how long
// an era (or a planet that's never once gone flat) runs for.
export function enforceHardCap(samples: readonly PlanetHistorySample[]): PlanetHistorySample[] {
  if (samples.length <= HARD_CAP_SAMPLES) return [...samples];
  const splitIndex = Math.max(0, samples.length - RECENT_SAMPLES_KEPT_DENSE);
  const older = samples.slice(0, splitIndex);
  const recent = samples.slice(splitIndex);

  const result: PlanetHistorySample[] = [];
  let keepNext = true; // alternates only across non-capture samples - see the loop below
  for (let i = 0; i < older.length; i++) {
    const isCapture = i === 0 || isCaptureTransition(older[i - 1], older[i]);
    if (isCapture) {
      result.push(older[i]);
      continue;
    }
    if (keepNext) result.push(older[i]);
    keepNext = !keepNext;
  }
  return [...result, ...recent];
}

// The full write-time compression pipeline, in order: truncate at the last reopen first (nothing
// before a reopen is worth spending compression effort on), then lossless run-collapsing, then the
// 5-minute floor on older samples, then the hard ceiling if that still isn't enough. Called on
// every append so the *stored* array (not just what a reader happens to request) stays bounded -
// this is what keeps a bucket's total size from scaling with how long its planets' eras have been
// running, which is what actually drove the per-tick cost that led to the CPU-limit failures this
// exists to prevent a recurrence of.
export function compressHistorySamples(samples: readonly PlanetHistorySample[]): PlanetHistorySample[] {
  return enforceHardCap(thinOlderSamples(collapseIdenticalRuns(truncateAtLastReopen(samples))));
}

// Pure: what one planet's cached entry becomes after recording one new tick's row - appends to its
// existing samples (compressed - see compressHistorySamples), or starts fresh with just the new
// sample on an era reset (sunk -> trackable) or when there's no existing entry yet (first tick ever
// recorded for this planet).
export function appendToHistoryCache(existing: HistoryCacheEntry | null, row: PlanetHistoryRow): HistoryCacheEntry {
  const sample: PlanetHistorySample = {
    atMs: row.atMs,
    imperialRemaining: row.imperialRemaining,
    devastationRemaining: row.devastationRemaining,
    imperialAccrued: row.imperialAccrued,
    devastationAccrued: row.devastationAccrued,
    imperialThreshold: row.imperialThreshold,
    devastationThreshold: row.devastationThreshold,
  };
  const samples = !existing || isEraReset(existing.lastSunk, row.sunk) ? [sample] : compressHistorySamples([...existing.samples, sample]);
  return { samples, lastSunk: row.sunk };
}

// Planets per bucket row, and the resulting bucket-assignment function - see
// migrations/0009_planet_history_buckets.sql for the exact size math (8 keeps a bucket's
// worst-case size, every planet simultaneously at compressHistorySamples' 999-sample hard cap, to
// ~1.77MB - 88.7% of D1's 2MB per-row limit, real margin rather than a near-miss).
export const PLANETS_PER_BUCKET = 8;

// Stable for the whole season (planet-data.json's declared order never changes mid-season) - a
// plain index-based assignment, not a hash, so it's trivially reproducible (migrations/0009's own
// backfill CASE expression is this exact same mapping, generated from the same file). Rebuilt on
// every call rather than cached at module scope - cheap (146 entries) and avoids any risk of a
// stale mapping surviving a season switchover (src/season.ts) within a long-lived isolate.
export function buildBucketAssignments(): Map<string, number> {
  const planets = getPlanetData() as { planetId: string }[];
  return new Map(planets.map((p, i) => [p.planetId, Math.floor(i / PLANETS_PER_BUCKET)]));
}

// A stored planet entry is tagged with which season (src/season.ts) it was recorded under - 135 of
// the 146 planet ids in season 1.41 are REUSED as-is in 1.43 (confirmed by diffing both seasons'
// planet-data.json), so without this tag, a returning planet's stale prior-season samples would
// get silently treated as "still the same era" the moment it's contested again next season (none
// of isEraReset/truncateAtLastReopen above know anything about season boundaries - they're purely
// about capture/reopen cycles within one season's own map). buildBucketUpsertStatements/
// getPlanetHistory/getAllPlanetHistory below all check this tag against activeSeason() and treat a
// mismatch exactly like "no prior entry" - same as a brand new planet - so a season switch needs
// zero manual migration/code change to behave correctly; the very next write (or even just a read,
// before any write happens) for a reused planet id auto-resets cleanly. Planets that exist only in
// a past season (not carried into the new one) simply stop being touched at all - inert, orphaned
// dead weight in their old bucket, not actively harmful, just not cleaned up by this mechanism.
export interface StoredPlanetHistory extends HistoryCacheEntry {
  season: Season;
}

// One bucket row's stored shape: every planet in that bucket that has ever had history recorded,
// keyed by planetId.
export type BucketHistoryData = Record<string, StoredPlanetHistory>;

interface BucketRow {
  data: string;
}

// Pure: what appendToHistoryCache should treat as "existing" for this planet, given whatever's
// actually stored (if anything) and the season active right now. A season mismatch is treated
// identically to "nothing stored yet" - see StoredPlanetHistory's own comment above.
export function resolveExistingForAppend(stored: StoredPlanetHistory | undefined, currentSeason: Season): HistoryCacheEntry | null {
  return stored && stored.season === currentSeason ? stored : null;
}

// Pure: whether a stored entry should be visible to a reader right now - same season-match rule as
// resolveExistingForAppend, applied on the read side so a reader never sees a past season's
// leftover samples even before anything has written over them this season.
export function isVisibleThisSeason(stored: StoredPlanetHistory | undefined, currentSeason: Season): stored is StoredPlanetHistory {
  return stored !== undefined && stored.season === currentSeason;
}

// Builds one upsert statement per bucket touched by `planets` (always every bucket a relevant
// planet falls into - not conditionally skipped - so write volume is a flat, contention-
// independent function of bucket count, never of how many planets actually changed this cycle;
// see this file's top-of-file comment). Reads each touched bucket's current contents and the
// resulting merged write run concurrently across buckets (Promise.allSettled, not a sequential
// loop) - independent of each other, and no longer gated by any fetch budget since this is all
// local D1 reads/writes. A bucket whose read or merge throws is skipped (logged, not fatal) so one
// corrupted bucket never blocks every other bucket's valid write this cycle. Planets with no
// struggleData are skipped entirely - nothing to record, matching the old per-row behavior.
export async function buildBucketUpsertStatements(db: D1Database, planets: readonly CrusadePlanet[], nowMs: number): Promise<D1PreparedStatement[]> {
  const currentSeason = activeSeason(nowMs);
  const bucketAssignments = buildBucketAssignments();
  const planetsByBucket = new Map<number, CrusadePlanet[]>();
  for (const planet of planets) {
    if (!planet.struggleData) continue;
    const bucketId = bucketAssignments.get(planet.planetId) ?? 0;
    const existing = planetsByBucket.get(bucketId);
    if (existing) existing.push(planet);
    else planetsByBucket.set(bucketId, [planet]);
  }

  const bucketIds = [...planetsByBucket.keys()];
  const results = await Promise.allSettled(
    bucketIds.map(async (bucketId) => {
      const existingRow = await db.prepare("SELECT data FROM planet_history_buckets WHERE bucket_id = ?").bind(bucketId).first<BucketRow>();
      const bucketData: BucketHistoryData = existingRow ? JSON.parse(existingRow.data) : {};
      for (const planet of planetsByBucket.get(bucketId)!) {
        const existingForAppend = resolveExistingForAppend(bucketData[planet.planetId], currentSeason);
        const row = buildHistoryRow(planet, nowMs);
        bucketData[planet.planetId] = { ...appendToHistoryCache(existingForAppend, row), season: currentSeason };
      }
      return db
        .prepare(
          "INSERT INTO planet_history_buckets (bucket_id, data, updated_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(bucket_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        )
        .bind(bucketId, JSON.stringify(bucketData), nowMs);
    }),
  );

  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") statements.push(result.value);
    else console.error(`[poller] bucket ${bucketIds[i]} history write failed`, result.reason);
  }
  return statements;
}

// Read glue for GET /api/planet-history (worker/index.ts) - the current era's full history for one
// planet, oldest first (matches TrackedPlanetSample's own ordering expectation client-side). A
// single-row read (that planet's whole bucket) regardless of how much history has accumulated.
// Filters out a stored entry from a past season (see StoredPlanetHistory) even if nothing has
// written over it yet this season - a reader should never see stale cross-season history either.
export async function getPlanetHistory(db: D1Database, planetId: string): Promise<PlanetHistorySample[]> {
  const bucketId = buildBucketAssignments().get(planetId) ?? 0;
  const row = await db.prepare("SELECT data FROM planet_history_buckets WHERE bucket_id = ?").bind(bucketId).first<BucketRow>();
  if (!row) return [];
  const bucketData: BucketHistoryData = JSON.parse(row.data);
  const entry = bucketData[planetId];
  return isVisibleThisSeason(entry, activeSeason()) ? entry.samples : [];
}

// Read glue for GET /api/planet-history-all (worker/index.ts) - every planet's current-era history
// in one query/round-trip, grouped by planetId, instead of the Monitor tab issuing one
// getPlanetHistory request per planet. One row per bucket (~19 total) regardless of how much
// history has accumulated per planet - see this file's top-of-file comment for why that matters.
// Same past-season filtering as getPlanetHistory above.
export async function getAllPlanetHistory(db: D1Database): Promise<Map<string, PlanetHistorySample[]>> {
  const currentSeason = activeSeason();
  const result = await db.prepare("SELECT data FROM planet_history_buckets").all<BucketRow>();
  const byPlanet = new Map<string, PlanetHistorySample[]>();
  for (const row of result.results ?? []) {
    const bucketData: BucketHistoryData = JSON.parse(row.data);
    for (const [planetId, entry] of Object.entries(bucketData)) {
      if (isVisibleThisSeason(entry, currentSeason)) byPlanet.set(planetId, entry.samples);
    }
  }
  return byPlanet;
}

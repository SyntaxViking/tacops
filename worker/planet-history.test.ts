import { describe, expect, it } from "vitest";
import {
  appendToHistoryCache,
  buildBucketAssignments,
  buildHistoryRow,
  collapseIdenticalRuns,
  compressHistorySamples,
  enforceHardCap,
  isEraReset,
  isVisibleThisSeason,
  PLANETS_PER_BUCKET,
  resolveExistingForAppend,
  thinOlderSamples,
  truncateAtLastReopen,
  type PlanetHistoryRow,
  type PlanetHistorySample,
  type StoredPlanetHistory,
} from "./planet-history";
import type { CrusadePlanet } from "../src/api/types";

describe("buildBucketAssignments", () => {
  it("assigns every known planet to a bucket, with no bucket holding more than PLANETS_PER_BUCKET planets", () => {
    const assignments = buildBucketAssignments();
    expect(assignments.size).toBeGreaterThan(0);

    const counts = new Map<number, number>();
    for (const bucketId of assignments.values()) {
      counts.set(bucketId, (counts.get(bucketId) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(PLANETS_PER_BUCKET);
    }
  });

  it("is deterministic across calls (same planet always lands in the same bucket)", () => {
    const first = buildBucketAssignments();
    const second = buildBucketAssignments();
    expect(second).toEqual(first);
  });

  it("packs buckets densely - only the very last bucket may be under PLANETS_PER_BUCKET", () => {
    const assignments = buildBucketAssignments();
    const counts = new Map<number, number>();
    for (const bucketId of assignments.values()) {
      counts.set(bucketId, (counts.get(bucketId) ?? 0) + 1);
    }
    const sortedBucketIds = [...counts.keys()].sort((a, b) => a - b);
    const lastBucketId = sortedBucketIds[sortedBucketIds.length - 1];
    for (const bucketId of sortedBucketIds) {
      if (bucketId !== lastBucketId) expect(counts.get(bucketId)).toBe(PLANETS_PER_BUCKET);
    }
  });
});

function storedHistory(overrides: Partial<StoredPlanetHistory> = {}): StoredPlanetHistory {
  return { samples: [{ atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 }], lastSunk: false, season: "1.41", ...overrides };
}

describe("resolveExistingForAppend", () => {
  it("returns the stored entry as-is when its season matches the current one", () => {
    const stored = storedHistory({ season: "1.41" });
    expect(resolveExistingForAppend(stored, "1.41")).toEqual(stored);
  });

  it("returns null when the stored entry's season doesn't match - a reused planet id from a past season must never be appended to", () => {
    const stored = storedHistory({ season: "1.41" });
    expect(resolveExistingForAppend(stored, "1.43")).toBeNull();
  });

  it("returns null when there's no stored entry at all", () => {
    expect(resolveExistingForAppend(undefined, "1.41")).toBeNull();
  });
});

describe("isVisibleThisSeason", () => {
  it("is true when the stored entry's season matches the current one", () => {
    expect(isVisibleThisSeason(storedHistory({ season: "1.43" }), "1.43")).toBe(true);
  });

  it("is false when the stored entry belongs to a past season - a reader must never see stale cross-season history", () => {
    expect(isVisibleThisSeason(storedHistory({ season: "1.41" }), "1.43")).toBe(false);
  });

  it("is false when there's no stored entry at all", () => {
    expect(isVisibleThisSeason(undefined, "1.41")).toBe(false);
  });
});

// buildHistoryRow only reads sideOwner/pointsFor/pointsAgainst/struggleData (never name/zone) -
// plain placeholders for the rest, same as worker/poller.ts's own real-data construction (via
// src/crusade/crusade-data-mapping.ts's mapCrusadeResponseData) never relies on this test's
// specific name/zone values either.
function testPlanet(overrides: Partial<CrusadePlanet> & Pick<CrusadePlanet, "planetId">): CrusadePlanet {
  return { name: overrides.planetId, zone: null, ...overrides };
}

describe("buildHistoryRow", () => {
  it("computes remaining points and sunk for a live contested planet", () => {
    const planet = testPlanet({
      planetId: "planet_001",
      sideOwner: "For",
      pointsFor: 100,
      pointsAgainst: 50,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(buildHistoryRow(planet, 5000)).toEqual({
      planetId: "planet_001",
      atMs: 5000,
      imperialRemaining: 900,
      devastationRemaining: 950,
      imperialAccrued: 100,
      devastationAccrued: 50,
      imperialThreshold: 1000,
      devastationThreshold: 1000,
      sunk: false,
    });
  });

  it("marks sunk true once a side has reached its own threshold", () => {
    const planet = testPlanet({
      planetId: "planet_001",
      sideOwner: "For",
      pointsFor: 1000,
      pointsAgainst: 50,
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(buildHistoryRow(planet, 5000).sunk).toBe(true);
  });

  it("marks sunk true for the idle (0/0) cooldown state too", () => {
    const planet = testPlanet({
      planetId: "planet_001",
      struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
    });
    expect(buildHistoryRow(planet, 5000).sunk).toBe(true);
  });
});

describe("isEraReset", () => {
  it("is true only when a planet flips from sunk to trackable", () => {
    expect(isEraReset(true, false)).toBe(true);
  });

  it("is false when staying sunk", () => {
    expect(isEraReset(true, true)).toBe(false);
  });

  it("is false when staying trackable", () => {
    expect(isEraReset(false, false)).toBe(false);
  });

  it("is false when newly becoming sunk", () => {
    expect(isEraReset(false, true)).toBe(false);
  });

  it("is false when there's no prior history yet (null)", () => {
    expect(isEraReset(null, false)).toBe(false);
    expect(isEraReset(null, true)).toBe(false);
  });
});

describe("appendToHistoryCache", () => {
  function row(overrides: Partial<PlanetHistoryRow> = {}): PlanetHistoryRow {
    return { planetId: "planet_001", atMs: 1000, imperialRemaining: 900, devastationRemaining: 800, sunk: false, ...overrides };
  }

  it("starts a fresh single-sample array when there's no existing entry yet", () => {
    expect(appendToHistoryCache(null, row())).toEqual({
      samples: [{ atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 }],
      lastSunk: false,
    });
  });

  it("appends to the existing samples when the planet is still in the same era", () => {
    const existing = { samples: [{ atMs: 500, imperialRemaining: 950, devastationRemaining: 900 }], lastSunk: false };
    expect(appendToHistoryCache(existing, row())).toEqual({
      samples: [
        { atMs: 500, imperialRemaining: 950, devastationRemaining: 900 },
        { atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 },
      ],
      lastSunk: false,
    });
  });

  it("starts a fresh single-sample array on an era reset (sunk -> trackable), discarding the old era's samples", () => {
    const existing = { samples: [{ atMs: 500, imperialRemaining: 0, devastationRemaining: 900 }], lastSunk: true };
    expect(appendToHistoryCache(existing, row({ sunk: false }))).toEqual({
      samples: [{ atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 }],
      lastSunk: false,
    });
  });

  it("keeps accumulating while staying sunk (e.g. still in cooldown)", () => {
    // Remaining stays <= 0 on both samples (a realistic "still mid-cooldown" pair, unlike a sunk
    // flag paired with a since-recovered positive remaining - see truncateAtLastReopen, which
    // would (correctly) treat THAT combination as a reopen regardless of what the sunk flag says).
    const existing = { samples: [{ atMs: 500, imperialRemaining: 0, devastationRemaining: 900 }], lastSunk: true };
    expect(appendToHistoryCache(existing, row({ sunk: true, imperialRemaining: -10, devastationRemaining: 800 })).samples).toHaveLength(2);
  });

  it("compresses the merged samples on every append (not just when a cap is hit)", () => {
    // Three identical-value samples followed by the new (also identical) row should collapse to
    // just the run's first and last - confirms appendToHistoryCache actually calls
    // compressHistorySamples rather than just concatenating.
    const existing = {
      samples: [
        { atMs: 100, imperialRemaining: 900, devastationRemaining: 800 },
        { atMs: 200, imperialRemaining: 900, devastationRemaining: 800 },
        { atMs: 300, imperialRemaining: 900, devastationRemaining: 800 },
      ],
      lastSunk: false,
    };
    expect(appendToHistoryCache(existing, row({ atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 })).samples).toEqual([
      { atMs: 100, imperialRemaining: 900, devastationRemaining: 800 },
      { atMs: 1000, imperialRemaining: 900, devastationRemaining: 800 },
    ]);
  });
});

function sample(atMs: number, imperialRemaining: number, devastationRemaining: number): PlanetHistorySample {
  return { atMs, imperialRemaining, devastationRemaining };
}

describe("truncateAtLastReopen", () => {
  it("leaves samples unchanged when remaining never crosses back above 0", () => {
    const samples = [sample(1, 900, 800), sample(2, 500, 400), sample(3, 100, 50)];
    expect(truncateAtLastReopen(samples)).toEqual(samples);
  });

  it("drops the reopen crossing itself once a decrease immediately follows it", () => {
    const samples = [
      sample(1, 900, 800),
      sample(2, 0, 400), // imperial captured
      sample(3, -50, 200), // still captured, cooldown
      sample(4, 300, 100), // reopened (cooldown snap-back to full threshold) - not yet real progress
      sample(5, 250, 50), // first genuine decrease - this is where the new era actually starts
    ];
    expect(truncateAtLastReopen(samples)).toEqual([sample(5, 250, 50)]);
  });

  it("drops the entire dead zone between a reopen and the first real decrease - the actual bug this exists to fix", () => {
    // Reopen snaps remaining up to full threshold (the cooldown's pointsFor/pointsAgainst reset to
    // 0, which is what isInDominationCooldown checks), then sits flat (uncontested) and even gets
    // bumped higher by a defender's powerup, for a long stretch, before anyone finally attacks.
    const samples = [
      sample(1, 900, 800),
      sample(2, -50, 400), // captured
      sample(3, 1000, 1000), // reopened - full threshold, nobody attacking yet
      sample(4, 1000, 1000), // still uncontested, unchanged
      sample(5, 1200, 1000), // a defender's powerup bumps imperial's threshold up - still nobody attacking
      sample(6, 1200, 1000), // still flat
      sample(7, 1150, 1000), // first real decrease - attacking has finally started
      sample(8, 1050, 900),
    ];
    expect(truncateAtLastReopen(samples)).toEqual([sample(7, 1150, 1000), sample(8, 1050, 900)]);
  });

  it("falls back to the reopen crossing itself when no decrease has happened yet", () => {
    const samples = [sample(1, 900, 800), sample(2, -50, 400), sample(3, 1000, 1000), sample(4, 1000, 1000)];
    expect(truncateAtLastReopen(samples)).toEqual([sample(3, 1000, 1000), sample(4, 1000, 1000)]);
  });

  it("finds the LAST reopen when there's more than one capture/reopen cycle, then anchors to ITS first decrease", () => {
    const samples = [
      sample(1, 900, 800),
      sample(2, 0, 800), // capture 1
      sample(3, 300, 800), // reopen 1
      sample(4, 250, 800), // decrease after reopen 1 - irrelevant, a later reopen supersedes it
      sample(5, 300, 0), // capture 2 (devastation side this time)
      sample(6, 300, 150), // reopen 2 - this is the one that should win
      sample(7, 300, 100), // first decrease after reopen 2
    ];
    expect(truncateAtLastReopen(samples)).toEqual([sample(7, 300, 100)]);
  });

  it("triggers reopen-detection on either side independently", () => {
    const samples = [sample(1, 900, 0), sample(2, 900, 300), sample(3, 900, 250)]; // only devastation reopens, then decreases
    expect(truncateAtLastReopen(samples)).toEqual([sample(3, 900, 250)]);
  });

  it("triggers decrease-detection on either side independently", () => {
    // After reopening, imperial stays flat/increases but devastation decreases first - that alone
    // counts as real progress resuming.
    const samples = [sample(1, 900, 0), sample(2, 900, 300), sample(3, 950, 250)]; // imperial went UP, devastation went down
    expect(truncateAtLastReopen(samples)).toEqual([sample(3, 950, 250)]);
  });
});

describe("collapseIdenticalRuns", () => {
  it("leaves samples unchanged when no two consecutive ones match", () => {
    const samples = [sample(1, 900, 800), sample(2, 850, 790), sample(3, 800, 780)];
    expect(collapseIdenticalRuns(samples)).toEqual(samples);
  });

  it("collapses a run of 3+ identical samples to just its first and last", () => {
    const samples = [sample(1, 900, 800), sample(2, 900, 800), sample(3, 900, 800), sample(4, 900, 800)];
    expect(collapseIdenticalRuns(samples)).toEqual([sample(1, 900, 800), sample(4, 900, 800)]);
  });

  it("leaves a run of exactly 2 identical samples alone (nothing redundant to drop)", () => {
    const samples = [sample(1, 900, 800), sample(2, 900, 800)];
    expect(collapseIdenticalRuns(samples)).toEqual(samples);
  });

  it("handles multiple separate runs and singletons mixed together", () => {
    const samples = [
      sample(1, 900, 800), // singleton
      sample(2, 500, 500),
      sample(3, 500, 500),
      sample(4, 500, 500), // run of 3 -> collapses to [2, 4]
      sample(5, 100, 100), // singleton
    ];
    expect(collapseIdenticalRuns(samples)).toEqual([sample(1, 900, 800), sample(2, 500, 500), sample(4, 500, 500), sample(5, 100, 100)]);
  });

  it("collapses a run at the very start or end of the array", () => {
    const samples = [sample(1, 900, 800), sample(2, 900, 800), sample(3, 900, 800), sample(4, 100, 100)];
    expect(collapseIdenticalRuns(samples)).toEqual([sample(1, 900, 800), sample(3, 900, 800), sample(4, 100, 100)]);
  });

  it("handles an empty array and a single-sample array", () => {
    expect(collapseIdenticalRuns([])).toEqual([]);
    expect(collapseIdenticalRuns([sample(1, 900, 800)])).toEqual([sample(1, 900, 800)]);
  });
});

const FIVE_MIN_MS = 5 * 60 * 1000;

describe("thinOlderSamples", () => {
  it("leaves everything alone at or under the 10-sample recent-window size", () => {
    const samples = Array.from({ length: 10 }, (_, i) => sample(i * 1000, 900 - i, 800 - i));
    expect(thinOlderSamples(samples)).toEqual(samples);
  });

  it("thins the older portion to a 5-minute floor while leaving the most recent 10 untouched regardless of spacing", () => {
    // 5 older samples 1 minute apart (should thin down to ~2: first, then the first one >=5min later),
    // followed by 10 recent samples 1 second apart (always kept, no thinning).
    const older = [sample(0, 10, 10), sample(60_000, 9, 9), sample(120_000, 8, 8), sample(180_000, 7, 7), sample(300_000, 6, 6)];
    const recentStart = 600_000;
    const recent = Array.from({ length: 10 }, (_, i) => sample(recentStart + i * 1000, 5 - i, 5 - i));
    const result = thinOlderSamples([...older, ...recent]);

    // Older: keep index 0 (t=0), then skip until >=5min later - t=300_000 (5min exactly) qualifies.
    expect(result.slice(0, 2)).toEqual([sample(0, 10, 10), sample(300_000, 6, 6)]);
    // Recent 10 are preserved exactly, 1s apart, untouched by the 5-minute rule.
    expect(result.slice(2)).toEqual(recent);
  });

  it("always keeps the very first sample even with 11 total (1 older + 10 recent)", () => {
    const samples = [sample(0, 10, 10), ...Array.from({ length: 10 }, (_, i) => sample((i + 1) * 1000, 5 - i, 5 - i))];
    const result = thinOlderSamples(samples);
    expect(result[0]).toEqual(sample(0, 10, 10));
    expect(result).toHaveLength(11);
  });
});

describe("enforceHardCap", () => {
  it("leaves the array unchanged at or under the 999-sample cap", () => {
    const samples = Array.from({ length: 999 }, (_, i) => sample(i, 1000 - i, 1000 - i));
    expect(enforceHardCap(samples)).toEqual(samples);
  });

  it("roughly halves a non-extreme middle while always keeping the first sample and the most recent 10", () => {
    // 1010 samples, strictly decreasing (no extremes - stays positive throughout), no two equal.
    const samples = Array.from({ length: 1010 }, (_, i) => sample(i, 2000 - i, 2000 - i));
    const result = enforceHardCap(samples);

    expect(result[0]).toEqual(samples[0]);
    expect(result.slice(-10)).toEqual(samples.slice(-10));
    // 1000 "older" samples (1010 - 10 recent): first is always kept, the remaining 999 alternate ->
    // 1 (first) + ceil(999/2) = 1 + 500 = 501 older samples, plus 10 recent = 511.
    expect(result).toHaveLength(511);
  });

  it("never drops an extreme (a sign change in either side's remaining) even mid-run", () => {
    // Long non-extreme runs on either side of one capture moment (devastation crosses to 0) -
    // imperial stays constant and positive throughout so this is the only sign-change transition
    // anywhere in the array.
    const before = Array.from({ length: 500 }, (_, i) => sample(i, 500, 500 - i)); // devastation 500 -> 1, never 0
    const captureMoment = sample(500, 500, 0); // devastation hits exactly 0 here - the extreme
    const after = Array.from({ length: 509 }, (_, i) => sample(501 + i, 500, 0)); // stays captured
    const samples = [...before, captureMoment, ...after];
    expect(samples.length).toBeGreaterThan(999);

    const result = enforceHardCap(samples);
    expect(result).toContainEqual(captureMoment);
  });
});

describe("compressHistorySamples", () => {
  it("chains lossless then lossy: a long flat run collapses first, so it never reaches the lossy/hard-cap stages", () => {
    const samples = Array.from({ length: 50 }, (_, i) => sample(i * FIVE_MIN_MS, 900, 800));
    expect(compressHistorySamples(samples)).toEqual([sample(0, 900, 800), sample(49 * FIVE_MIN_MS, 900, 800)]);
  });

  it("falls through to the hard cap when a long, never-repeating, never-5-minutes-apart series survives both earlier stages", () => {
    // 1200 strictly-decreasing-by-1 samples, 1ms apart (well under the 5-minute floor, so lossy
    // thinning does nothing here) - still over 999 after lossless+lossy, so the hard cap must kick in.
    const samples = Array.from({ length: 1200 }, (_, i) => sample(i, 2000 - i, 2000 - i));
    const result = compressHistorySamples(samples);
    expect(result.length).toBeLessThan(1200);
    expect(result.length).toBeLessThanOrEqual(999);
  });

  it("runs truncation first, so old-era samples before a reopen's first real decrease are dropped outright, not just compressed", () => {
    const oldEra = Array.from({ length: 30 }, (_, i) => sample(i * FIVE_MIN_MS, 0, 100 - i));
    const reopen = sample(30 * FIVE_MIN_MS, 900, 800);
    const current = sample(31 * FIVE_MIN_MS, 850, 780); // first real decrease after the reopen
    expect(compressHistorySamples([...oldEra, reopen, current])).toEqual([current]);
  });
});

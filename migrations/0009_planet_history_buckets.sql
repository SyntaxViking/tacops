-- Migration number: 0009 	 2026-10-17T00:00:00.000Z

-- Replaces planet_history_cache's one-row-per-planet design with one-row-per-bucket-of-8-planets.
-- A 146-planet Domination map meant up to 146 row-writes every 5-minute poller cycle for this
-- table alone - even after removing poller_planet_queue (see migrations/0008's own follow-up),
-- that was still enough D1 write-row volume to threaten the daily quota regardless of how
-- contested the map was (see AGENTS.md for the full writeup). Bucket size (8 planets/row) is
-- chosen to stay comfortably under D1's 2MB per-row/string limit even if every planet in a bucket
-- is simultaneously at compressHistorySamples' own 999-sample hard cap - measured worst case
-- ~1.77MB (88.7% of the limit), real margin rather than a near-miss.
--
-- Bucket assignment is Math.floor(indexInPlanetData / 8) over the 1.41 season's planet-data.json
-- declared order (stable for the season, never changes mid-season) - see
-- worker/planet-history.ts's buildBucketAssignments. The CASE expression below is that exact
-- mapping for all 146 planets, generated from that same file, used only for this one-time backfill
-- of whichever planets already had a row in planet_history_cache.
CREATE TABLE planet_history_buckets (
  bucket_id INTEGER PRIMARY KEY,
  -- JSON object: { [planetId]: { "samples": [...PlanetHistorySample], "lastSunk": bool,
  -- "season": "1.41" } } for every planet assigned to this bucket that has ever had history
  -- recorded. "season" (src/season.ts) is what lets a season switch auto-reset a reused planet id
  -- with zero code/migration changes at the actual switchover moment - see
  -- worker/planet-history.ts's StoredPlanetHistory for the full rationale.
  data TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER
);

-- One-time backfill from planet_history_cache so currently-accumulated history isn't lost in the
-- switch (same precedent as migration 0007's own backfill). Tagged 'season': '1.41' - the real,
-- currently-active season (src/season.ts's SEASON_SCHEDULE) at the time this migration runs - so
-- these backfilled entries are correctly auto-reset the moment season 1.43 actually starts
-- touching any of the 135 planet ids the two seasons share, exactly like any other 1.41 entry.
-- json(CASE ... THEN 'true' ELSE 'false' END), not a bare `last_sunk = 1` comparison - verified
-- against this exact D1 instance that json_object() serializes a plain comparison result as the
-- INTEGER 1/0, not the JSON boolean true/false (worker/planet-history.ts's isEraReset does a
-- strict `=== true` check, which a leftover numeric 1 would silently fail forever).
INSERT INTO planet_history_buckets (bucket_id, data, updated_at)
SELECT
  bucket_id,
  json_group_object(planet_id, json_object('samples', json(samples), 'lastSunk', json(CASE WHEN last_sunk = 1 THEN 'true' ELSE 'false' END), 'season', '1.41')),
  MAX(updated_at)
FROM (
  SELECT
    planet_id, samples, last_sunk, updated_at,
    CASE planet_id
      WHEN 'planet_001' THEN 0
      WHEN 'planet_002' THEN 0
      WHEN 'planet_003' THEN 0
      WHEN 'planet_004' THEN 0
      WHEN 'planet_005' THEN 0
      WHEN 'planet_006' THEN 0
      WHEN 'planet_007' THEN 0
      WHEN 'planet_008' THEN 0
      WHEN 'planet_009' THEN 1
      WHEN 'planet_010' THEN 1
      WHEN 'planet_011' THEN 1
      WHEN 'planet_012' THEN 1
      WHEN 'planet_013' THEN 1
      WHEN 'planet_014' THEN 1
      WHEN 'planet_015' THEN 1
      WHEN 'planet_017' THEN 1
      WHEN 'planet_018' THEN 2
      WHEN 'planet_021' THEN 2
      WHEN 'planet_022' THEN 2
      WHEN 'planet_024' THEN 2
      WHEN 'planet_025' THEN 2
      WHEN 'planet_026' THEN 2
      WHEN 'planet_027' THEN 2
      WHEN 'planet_028' THEN 2
      WHEN 'planet_029' THEN 3
      WHEN 'planet_030' THEN 3
      WHEN 'planet_031' THEN 3
      WHEN 'planet_032' THEN 3
      WHEN 'planet_033' THEN 3
      WHEN 'planet_034' THEN 3
      WHEN 'planet_035' THEN 3
      WHEN 'planet_036' THEN 3
      WHEN 'planet_037' THEN 4
      WHEN 'planet_041' THEN 4
      WHEN 'planet_042' THEN 4
      WHEN 'planet_043' THEN 4
      WHEN 'planet_044' THEN 4
      WHEN 'planet_045' THEN 4
      WHEN 'planet_046' THEN 4
      WHEN 'planet_047' THEN 4
      WHEN 'planet_048' THEN 5
      WHEN 'planet_049' THEN 5
      WHEN 'planet_050' THEN 5
      WHEN 'planet_051' THEN 5
      WHEN 'planet_052' THEN 5
      WHEN 'planet_054' THEN 5
      WHEN 'planet_055' THEN 5
      WHEN 'planet_058' THEN 5
      WHEN 'planet_060' THEN 6
      WHEN 'planet_063' THEN 6
      WHEN 'planet_064' THEN 6
      WHEN 'planet_066' THEN 6
      WHEN 'planet_067' THEN 6
      WHEN 'planet_068' THEN 6
      WHEN 'planet_069' THEN 6
      WHEN 'planet_070' THEN 6
      WHEN 'planet_071' THEN 7
      WHEN 'planet_073' THEN 7
      WHEN 'planet_074' THEN 7
      WHEN 'planet_075' THEN 7
      WHEN 'planet_076' THEN 7
      WHEN 'planet_077' THEN 7
      WHEN 'planet_078' THEN 7
      WHEN 'planet_079' THEN 7
      WHEN 'planet_080' THEN 8
      WHEN 'planet_081' THEN 8
      WHEN 'planet_082' THEN 8
      WHEN 'planet_083' THEN 8
      WHEN 'planet_084' THEN 8
      WHEN 'planet_085' THEN 8
      WHEN 'planet_086' THEN 8
      WHEN 'planet_087' THEN 8
      WHEN 'planet_088' THEN 9
      WHEN 'planet_090' THEN 9
      WHEN 'planet_091' THEN 9
      WHEN 'planet_092' THEN 9
      WHEN 'planet_093' THEN 9
      WHEN 'planet_094' THEN 9
      WHEN 'planet_095' THEN 9
      WHEN 'planet_096' THEN 9
      WHEN 'planet_098' THEN 10
      WHEN 'planet_103' THEN 10
      WHEN 'planet_104' THEN 10
      WHEN 'planet_105' THEN 10
      WHEN 'planet_106' THEN 10
      WHEN 'planet_107' THEN 10
      WHEN 'planet_108' THEN 10
      WHEN 'planet_110' THEN 10
      WHEN 'planet_111' THEN 11
      WHEN 'planet_113' THEN 11
      WHEN 'planet_114' THEN 11
      WHEN 'planet_115' THEN 11
      WHEN 'planet_116' THEN 11
      WHEN 'planet_117' THEN 11
      WHEN 'planet_119' THEN 11
      WHEN 'planet_120' THEN 11
      WHEN 'sun_01' THEN 12
      WHEN 'sun_02' THEN 12
      WHEN 'sun_03' THEN 12
      WHEN 'sun_04' THEN 12
      WHEN 'sun_05' THEN 12
      WHEN 'sun_06' THEN 12
      WHEN 'sun_07' THEN 12
      WHEN 'sun_08' THEN 12
      WHEN 'sun_09' THEN 13
      WHEN 'sun_10' THEN 13
      WHEN 'sun_11' THEN 13
      WHEN 'sun_12' THEN 13
      WHEN 'sun_13' THEN 13
      WHEN 'sun_14' THEN 13
      WHEN 'sun_15' THEN 13
      WHEN 'sun_16' THEN 13
      WHEN 'sun_17' THEN 14
      WHEN 'sun_18' THEN 14
      WHEN 'sun_19' THEN 14
      WHEN 'sun_20' THEN 14
      WHEN 'sun_21' THEN 14
      WHEN 'sun_22' THEN 14
      WHEN 'sun_23' THEN 14
      WHEN 'sun_24' THEN 14
      WHEN 'sun_25' THEN 15
      WHEN 'sun_26' THEN 15
      WHEN 'sun_27' THEN 15
      WHEN 'sun_28' THEN 15
      WHEN 'sun_29' THEN 15
      WHEN 'sun_30' THEN 15
      WHEN 'sun_31' THEN 15
      WHEN 'sun_32' THEN 15
      WHEN 'sun_33' THEN 16
      WHEN 'sun_34' THEN 16
      WHEN 'sun_35' THEN 16
      WHEN 'sun_36' THEN 16
      WHEN 'sun_37' THEN 16
      WHEN 'sun_38' THEN 16
      WHEN 'sun_39' THEN 16
      WHEN 'sun_40' THEN 16
      WHEN 'sun_41' THEN 17
      WHEN 'sun_42' THEN 17
      WHEN 'sun_43' THEN 17
      WHEN 'sun_44' THEN 17
      WHEN 'sun_45' THEN 17
      WHEN 'sun_46' THEN 17
      WHEN 'sun_47' THEN 17
      WHEN 'sun_48' THEN 17
      WHEN 'sun_49' THEN 18
      WHEN 'sun_50' THEN 18
    END AS bucket_id
  FROM planet_history_cache
) AS bucketed
WHERE bucket_id IS NOT NULL
GROUP BY bucket_id;

-- planet_history_cache is left in place, unused by the app from this point on, as a safety net -
-- same precedent as migration 0007 leaving planet_history/planet_history_state in place.

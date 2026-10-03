-- Migration number: 0006 	 2026-10-03T00:00:00.000Z

-- idx_planet_history_planet_id duplicated what the PRIMARY KEY (planet_id, at_ms) already covers
-- for every query actually run against planet_history (WHERE planet_id = ? [ORDER BY at_ms], and
-- the era-reset DELETE WHERE planet_id = ?) - SQLite already satisfies an equality filter on a
-- composite index's leading column with no separate index needed. Carrying this redundant index
-- cost a third extra "row written" (D1 billing) on every single history insert - 3 B-tree writes
-- (base table + the PK index + this one) instead of 2 - for zero read benefit, and was the single
-- largest contributor pushing the account's D1 Free-plan 100,000-rows-written/day budget right up
-- against its ceiling (see the investigation that found this: ~68,652 of ~98,767 rows written/day
-- were this one table, at 3x the necessary cost).
DROP INDEX idx_planet_history_planet_id;

# Resuming the D1 quota fix (session paused 2026-10-17)

## Where things stand right now

- **D1 is out of its free-tier daily row-write quota.** Every write (even a tiny manual admin
  query) currently fails with `D1_ERROR: ... exceeded D1's free tier daily row write limit.
  Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.` It resets at
  **midnight UTC**.
- **The poller cron trigger is temporarily disabled** (`wrangler.toml`'s `crons = []`, deployed via
  PR #56, merged to master). This was done deliberately so the account doesn't immediately
  re-exhaust the quota tomorrow before the real fix below is deployed - the current season is
  basically over anyway, so nothing is lost by pausing it for a day.
- **The real fix is fully written, verified, and stashed locally** - `git stash list` shows
  `stash@{0}: On master: bucket/season D1 fix - pending quota reset`. It was never committed
  because applying its D1 migration requires the quota to actually be available, and we hit the
  wall mid-session. `npx tsc --noEmit` was clean and all 656 tests passed before stashing.

## What the stashed fix actually does

Two separate, real problems, both already root-caused and fixed in code:

1. **D1 write volume.** The poller used to write one `planet_history_cache` row per Domination
   planet (up to 146) every 5-minute cycle, unconditionally - during a hot/contested season that
   alone was enough to blow the 100K-rows/day free-tier cap, even after two earlier fixes this same
   session (removing the per-planet leaderboard fetch, then removing the `poller_planet_queue`
   walk). The fix: a new table, `planet_history_buckets` (migration `0009`), with one row per
   **8-planet bucket** (19 buckets for 146 planets) instead of one row per planet. Write volume
   becomes a flat ~21 writes/cycle (19 buckets + crusade snapshot + epoch state) regardless of how
   contested the map is - roughly 6,000 rows/day instead of 200,000+.
   - Bucket size (8) was chosen with real margin under D1's 2MB per-row limit, verified against
     `compressHistorySamples`' 999-sample hard cap: worst case ~1.77MB (88.7% of the limit).
   - `worker/poller.ts`'s old `poller_planet_queue`/`"planets"` phase branch is **deliberately left
     in the file as dead code, never deleted, never called again** - per explicit instruction, not
     an oversight. Don't "clean it up" later.
2. **Season-boundary correctness.** 135 of the 146 planet ids in season 1.41 are reused as-is in
   season 1.43 (confirmed by diffing both `planet-data.json` files). Without tracking which season
   a stored entry belongs to, a reused planet id's stale prior-season samples would get silently
   treated as "still the same era" the instant it's contested again next season. Fixed by tagging
   every stored entry with its season (`StoredPlanetHistory.season`) and treating a mismatch
   exactly like "nothing stored yet" on both the write path (`resolveExistingForAppend`) and the
   read path (`isVisibleThisSeason`) - so the season switch needs **zero manual code change** to
   behave correctly, verified by direct dry-run queries against production D1 before trusting it.

Full narrative and the "don't revert this" warnings are in `AGENTS.md`'s "Leaderboard data" section
(the stashed version - not the one currently checked out, since `AGENTS.md` itself is part of the
stash).

## Exact steps to resume (do these in order)

1. **Confirm the quota has actually reset**: `npx wrangler d1 info tacops-analytics` -
   `rows_written_24h` should be well under 100,000. If it's still pinned near the cap, the reset
   hasn't happened yet or something else is writing - investigate before proceeding.
2. **Sync the migrations tracking table.** `wrangler d1 migrations list tacops-analytics --remote`
   will show 0006/0007/0008 as "pending" even though those tables already exist in production (they
   were applied outside the normal tracked mechanism at some point before this session). Do NOT run
   `wrangler d1 migrations apply` yet - it would try to re-run their `CREATE TABLE` statements and
   fail. First run:
   ```sql
   INSERT INTO d1_migrations (name, applied_at) VALUES
     ('0006_drop_redundant_planet_history_index.sql', CURRENT_TIMESTAMP),
     ('0007_planet_history_cache.sql', CURRENT_TIMESTAMP),
     ('0008_poller_checkpointed_state.sql', CURRENT_TIMESTAMP);
   ```
   (via `npx wrangler d1 execute tacops-analytics --remote --command "..."`) - this was attempted
   once already this session and itself failed on the same quota error, so it still needs doing.
3. **Apply migration 0009**: `npx wrangler d1 migrations apply tacops-analytics --remote`. Should
   now see only `0009_planet_history_buckets.sql` as pending and apply cleanly. This creates
   `planet_history_buckets` and backfills it from `planet_history_cache` (tagged `season: "1.41"`).
   Spot-check afterward (e.g. `SELECT bucket_id, LENGTH(data) FROM planet_history_buckets`) that it
   looks sane - a dry-run of this exact backfill logic was already validated against real
   production data earlier this session, so it should just work.
4. **Restore the stashed code**: `git stash pop`. This brings back changes to `worker/poller.ts`,
   `worker/planet-history.ts`, `worker/planet-history.test.ts`, `AGENTS.md`, plus the new
   (untracked, so stash should have included it via `-u`) `migrations/0009_planet_history_buckets.sql`
   file - confirm `git status` shows all of these before continuing.
5. **Commit, PR, deploy** (same pattern as every other change this session): branch off master,
   commit, push, `gh pr create`, wait for the `test`/`Workers Builds` checks to pass, merge, pull
   master locally, confirm via `npx wrangler deployments list --name tacops` that a fresh version
   deployed.
6. **Re-enable the cron.** Edit `wrangler.toml` back to `crons = ["* * * * *"]` (remove the
   "TEMPORARILY DISABLED" comment), commit/PR/merge/deploy the same way. Remember Cloudflare Cron
   Trigger changes can take **up to 15 minutes** to propagate (confirmed via their own docs this
   session) - don't panic if `wrangler tail` shows a few more ticks (or a few more ticks of the
   *disable* lingering) right after either direction of this change.
7. **Verify it actually worked**: after the cron's been running again for an hour or so,
   `npx wrangler d1 info tacops-analytics` should show `rows_written_24h` tracking toward roughly
   6,000/day pace, not the ~200,000/day pace from before. A live `wrangler tail` capture (~70s) of a
   scheduled invocation should show `outcome: "ok"`, not a `D1_ERROR` exception.

## Open/non-blocking items (not part of the above, don't block on these)

- 11 planets exist only in season 1.41 (not 1.43) - their entries become permanently orphaned dead
  weight in whatever bucket they occupy. Harmless, bounded, just never cleaned up. Not worth fixing
  now.
- Whether to upgrade D1 to a paid plan at all (to get a hard quota ceiling with headroom, or to
  avoid ever hitting this specific free-tier wall again) is a separate, still-open decision from
  earlier in this session - the bucket fix makes the free tier viable again, but doesn't make this
  question moot if usage grows.

# Agent instructions

See the "Style requirements" section of [README.md](README.md) for style rules (Tailwind usage,
`.tsx`/`.ts` split). Kept there instead of duplicated here.

## Verifying changes

Don't start the dev server or drive it with Playwright/chromium-cli to verify a change works.
Run `npx tsc --noEmit` and `npm test`, then just tell the user what to manually check (which
screen/tab, what button to click, what result to expect) instead.

## API version (`src/api-version.ts`)

`API_VERSION` is the client<->server API contract version, sent with every web client request and
enforced as the Worker's own minimum (`worker/client-version.ts`) - a request from a client whose
`apiVersion` is below the Worker's current `API_VERSION` is rejected outright (HTTP 426, no work
done), which forces that client to refresh the page.

**Never bump `API_VERSION` without the developer explicitly, deliberately asking for that exact
change in that exact request.** Most changes to the API or app are backwards compatible and should
ship with this number left alone - bumping it on an ordinary change would force-refresh every open
tab for no reason. It only goes up for a genuine breaking change, where old clients must not keep
talking to the new backend (or vice versa) until they update.

## Rollover cooldown (`src/rollover-window.ts`)

The game's own daily server reset/rollover happens around UTC midnight, and hammering a real
account's session with requests close to that time has caused account issues. `src/rollover-window.ts`
is the single source of truth for the resulting cooldown window (23:30-00:30 UTC), during which the
client refuses to send traffic (`src/rollover-guard.ts`'s global `fetch` wrap,
`src/api/invoke-with-timeout.ts`'s `ROLLOVER_GATED_COMMANDS` set) and the Worker refuses to serve it
(`worker/index.ts`), on top of the background poller doing no work during the same window
(`worker/poller.ts`).

**Whenever a new Worker route is added that makes a live call to the game's own servers on a real
account's credentials** (not just reading/writing tacops's own D1 cache) **, add the same
`isInRolloverWindow`/`ROLLOVER_WINDOW_RESPONSE` check** (`worker/index.ts`) that the existing
`/api/fetch-*` routes already have, mirroring how they're also version-gated. Same for any new
Tauri command that reaches the game's servers directly (not just tacops's own Worker) - add it to
`ROLLOVER_GATED_COMMANDS` in `src/api/invoke-with-timeout.ts`. Routes/commands that only touch
tacops's own D1 cache or local disk don't need this - gating those would degrade unrelated
functionality during the window for no account-safety benefit.

## Leaderboard data (`worker/poller.ts`, `src/crusade/crusade-domination-view-model.ts`)

The background poller (`worker/poller.ts`, cron every minute) only fetches crusade data
(GET_CRUSADE) - it deliberately never fetches per-planet leaderboard data (GET_LEADERBOARD_2).
It used to, writing to D1's `planet_leaderboard_cache` on every planet every tick, which blew
through D1's daily row-write quota (confirmed via a live `D1_ERROR: ... exceeded D1's free tier
daily row write limit`). That table is still defined in the schema but permanently unused now -
nothing reads or writes it.

Leaderboard data is purely a client-driven, opt-in fetch instead (`fetchOnePlanet`/
`fetchPlanetLeaderboard` in `src/App.tsx`/`src/api/fetch-crusade-data.ts`), gated by
`isPlanetAutoRefreshable` in `src/crusade/crusade-domination-view-model.ts` - only starred
planets auto-refresh (every ~5 minutes), the one live-tracked planet refreshes on its own much
faster loop (~10s), and any other planet only ever gets fetched once, on a manual refresh click.
**Don't widen `isPlanetAutoRefreshable`'s eligibility again** (e.g. back to "every unranked/
never-loaded planet") without deliberately re-checking D1's write-quota headroom first - that's
exactly the behavior that caused the original incident.

Removing the leaderboard fetch alone wasn't enough, though - even with it gone, the poller's own
GET_CRUSADE-refresh step (once every 5 minutes) was *still* close to the daily quota on its own,
because it rebuilt `poller_planet_queue` (a DELETE + up to 146 INSERTs) and then walked it one
planet at a time across many ticks (one more D1 row read AND write per planet per step) via a
`"planets"` phase - machinery that originally existed to checkpoint that same per-planet
*leaderboard fetch* across ticks (a slow, fallible network call), not to checkpoint a plain local
D1 read/write. Once the leaderboard fetch was removed, that queue/cursor walk kept running for no
remaining benefit, at real D1-operation cost. **`poller_planet_queue`/the `"planets"` phase branch
in `worker/poller.ts` are now dead code, kept in the file but never invoked** - the crusade_fetch
step now writes every relevant planet's history directly from the in-memory crusade response
instead, in the same batch, and always transitions straight back to `"awaiting_epoch"`. **Never
revive `poller_planet_queue` or transition `poller_epoch_state.phase` to `"planets"` again** -
that's the second half of the same incident, and bringing it back (even just the queue rebuild,
without ever walking it) reintroduces the D1-operation cost for nothing.

Even that wasn't the full fix, though: with the queue gone, the crusade_fetch step still wrote one
`planet_history_cache` row per relevant planet, unconditionally, every 5-minute cycle - during
Domination (STRUGGLE) every one of the 146 planets is relevant at once, and relying on "most
planets probably didn't change" to keep this cheap fails exactly when a season is hot and most of
them *are* changing. The fix: `planet_history_cache` (migrations/0007) is superseded by
`planet_history_buckets` (migrations/0009) - one row per `PLANETS_PER_BUCKET = 8` planets
(`worker/planet-history.ts`'s `buildBucketAssignments`/`buildBucketUpsertStatements`), not one row
per planet. Write volume is now a flat `NUM_BUCKETS` (19) writes every cycle, regardless of planet
count or contention - no longer something that degrades under load. `planet_history_cache` is left
in place, unused, same precedent as `poller_planet_queue`/`planet_leaderboard_cache`. **Don't lower
`PLANETS_PER_BUCKET` without re-checking D1's 2MB per-row limit against
`compressHistorySamples`'s 999-sample hard cap** (8/bucket keeps the worst case - every planet in
a bucket simultaneously at the cap - to ~1.77MB; see migrations/0009 for the exact math) - and
don't revert to one row per planet for the same reason as the queue above.

Separately (not a D1-cost issue, a correctness one): planet ids are heavily **reused across
seasons** (`src/season.ts`) - 135 of the 146 ids in season 1.41 are identical in 1.43. Without
tracking which season a stored entry belongs to, a reused planet id's stale prior-season samples
would get silently treated as "still the same era" the instant it's contested again next season -
`isEraReset`/`truncateAtLastReopen` only know about capture/reopen cycles within one season's own
map, nothing about season boundaries. Every `StoredPlanetHistory` entry is tagged with the season
it was written under; `resolveExistingForAppend`/`isVisibleThisSeason` in
`worker/planet-history.ts` treat a season mismatch exactly like "nothing stored yet" on both the
write and read paths, so a season switch needs **zero manual migration or code change** to behave
correctly - the first touch (even just a read) after the switch auto-resets a reused id cleanly.
**Never remove this season tag or let an entry get written/read without checking it against
`activeSeason()`** - that reopens the exact cross-season data-mixing bug this exists to prevent.

## Deploying the Worker (`board-assets/`)

`board-assets/` (PVP board background images + spawn-point manifest, used by the Arena tab) is
deliberately kept outside `public/`/`src/assets/` so it never gets bundled into the Tauri desktop
installer - `wrangler.toml`'s `[assets] directory` and `tauri.conf.json`'s `frontendDist` both
point at the same `dist/`, so anything under `public/` ships in both. Before running
`wrangler deploy`, after `npm run build`, copy it in manually:

```
cp -r board-assets/boards dist/boards
cp board-assets/spawn-points.json dist/spawn-points.json
```

CORS for these two paths (needed for the desktop app's webview, which fetches `spawn-points.json`
cross-origin - unlike every other Tauri call in this app, which goes through a Rust command
instead of the browser's `fetch`) is handled in `worker/index.ts` itself, via
`wrangler.toml`'s `run_worker_first` routing those two paths through the Worker before
`[assets]` - not a `_headers` file, since Cloudflare's static asset server 405s the CORS preflight
(`OPTIONS`) request with no way to attach headers to that failure from a `_headers` file alone.

Skip this for a `tauri build` - the desktop app fetches these from the live deployed Worker at
runtime instead of bundling them locally.

## Crusade seasons (`src/season.ts`)

See README's "Crusade seasons" section for how `SEASON_SCHEDULE` controls which season's planet
data is live (the switchover is timed via each season's `endsAt`, not manually flipped) and how to
prepare a new season. Kept there instead of duplicated here.

**Whenever the developer supplies a new season's planet/sector data, also ask for that season's
switchover date if `SEASON_SCHEDULE` doesn't already have one set.** A new season's data being
ready and its `endsAt` being set are two separate asks - don't assume the developer meant to leave
the previous season's `endsAt` as `null` just because they didn't mention it while handing over the
new data. If they don't have the date yet, that's fine - say so explicitly rather than silently
leaving it unset.

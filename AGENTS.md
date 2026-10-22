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

## Leaderboard data (`worker/poller.ts`, `worker/leaderboard-cache.ts`, `worker/struggle-eligibility.ts`)

An earlier version of the poller fetched every planet's leaderboard data on every tick, writing
to D1's `planet_leaderboard_cache` on every planet every tick, which blew through D1's daily
row-write quota (confirmed via a live `D1_ERROR: ... exceeded D1's free tier daily row write
limit`). The fix at the time was to rip server-side leaderboard fetching out entirely - leaderboard
data became purely a client-driven, opt-in fetch (still true today, see below), and the poller's
own `poller_planet_queue`/`"planets"` phase (originally built to checkpoint that per-planet
leaderboard fetch across ticks) became dead code once there was nothing left to checkpoint.

Server-side leaderboard polling is back, but with a much stricter, checkpointed design
(migrations/0010) specifically so write volume stays bounded regardless of planet count:
`worker/poller.ts`'s `runPollerTick` acquires `poller_lock` (unchanged CAS pattern), reads
`poller_leaderboard_cursor` (a singleton row holding the full ordered list of planets still to
poll this sweep, plus an index into it), and either calls GET_CRUSADE to rebuild that list (when
it's empty/exhausted) or fetches one listed planet's leaderboard (`worker/leaderboard-cache.ts`,
GET_LEADERBOARD_2) - committing the step's own result together with the cursor's advance and the
lock release in one atomic `db.batch()`. CRUSADE always exits after one step (one planet/minute);
STRUGGLE loops within one invocation, capped at `MAX_STRUGGLE_PLANETS_PER_TICK = 4` planets, since
a 143-planet map would otherwise take hours per planet at one-per-minute. **Don't raise that cap
without re-deriving the D1 write-budget math in `worker/poller.ts`'s own top-of-file comment** -
that's exactly the kind of change that caused the original incident.

STRUGGLE's eligible-planet list is deliberately narrower than every other planet-level mechanism
in this codebase: only planets not currently in their post-capture `cooldownRemainingMs` lockout
AND adjacent (via the static per-season `sector-map.json`'s `connections`, not any live fetch) to
a planet owned by the opposite side (`worker/struggle-eligibility.ts`'s `eligibleStrugglePlanetIds`).
History-write coverage (`planet_history_buckets`) stays the broader "every planet" list it always
was - these are two separate concerns, don't conflate them.

The cached leaderboard data itself (`shared_leaderboard_cache`, `worker/leaderboard-cache.ts`) is
account-agnostic by construction - it never computes `myRank`/`myPoints`/`nearMe` at all (not
merely strips them), since this cache is served to every visitor via the open `GET
/api/leaderboard-cache` route, including the logged-out home page. It carries `topFactionsFor`/
`topFactionsAgainst` (Leading Factions) and the Side Leaderboard's non-personal fields
(`numParticipants`/`benchmarks`/`topEntries`) for both sides independently. The client merges this
into the existing per-account `PlanetLeaderboard` shape via `toSeededPlanetLeaderboard`
(`src/api/crusade-cache-seed.ts`) - both at login (fast-paint, before the user's own live fetch
lands) and on an independent ~1-minute freshness-poll loop in `src/App.tsx` that adopts any cache
entry fresher than what's held locally. **Don't route personal data through this cache** - if a
future leaderboard field is ever added that's tied to a specific account, it belongs in the
per-account live fetch path below, never in `shared_leaderboard_cache`.

**`poller_epoch_state`/`poller_planet_queue` (migrations/0008) are now permanently abandoned**,
superseded by `poller_leaderboard_cursor` - left in place unused, same precedent as
`planet_history_cache`/the original `planet_leaderboard_cache` (migration 0004, also still
abandoned; `shared_leaderboard_cache` is a new, differently-scoped table, not a revival of it).
**Never revive `poller_planet_queue` or transition `poller_epoch_state.phase` to `"planets"`
again** - that machinery is gone for good, not just currently unused.

The existing client-driven, per-user leaderboard fetch is unchanged and still exactly as
important: `fetchOnePlanet`/`fetchPlanetLeaderboard` in `src/App.tsx`/`src/api/fetch-crusade-data.ts`,
gated by `isPlanetAutoRefreshable` in `src/crusade/crusade-domination-view-model.ts` - only
starred planets auto-refresh (every ~5 minutes), the one live-tracked planet refreshes on its own
much faster loop (~10s), and any other planet only ever gets fetched once, on a manual refresh
click. This is still the only path that ever produces personal `myRank`/`myPoints`/`nearMe`/the
per-faction player leaderboard data. **Don't widen `isPlanetAutoRefreshable`'s eligibility again**
(e.g. back to "every unranked/never-loaded planet") without deliberately re-checking D1's
write-quota headroom first.

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

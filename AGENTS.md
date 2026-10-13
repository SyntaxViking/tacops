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

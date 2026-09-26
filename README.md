# TacOps

Fetches your live Tacticus account data, shows your current operations board (as cards or a
table), and uses an integer-programming solver to suggest which characters to send on the rest of
your operations. Ships two ways: a [Tauri](https://tauri.app/) desktop app that reads your local
Tacticus credentials automatically, and a website (see [Web version](#web-version)) where you
enter them yourself each visit.

## Tech specs

The desktop app is a Tauri app: a Rust backend (`src-tauri/`) paired with a React/TypeScript
frontend (`src/`), running in the OS's native webview. The website shares that same `src/`
frontend, swapping the Rust backend for a small serverless proxy (see below).

### Backend (`src-tauri/`)

- **Rust** + [Tauri v2](https://v2.tauri.app/), using `reqwest` for HTTP and `serde`/`serde_json` for
  (de)serialization.
- `src-tauri/src/credentials.rs` — locates and parses the local Tacticus credentials file (see
  [Credentials](#credentials) below) and exposes it to the frontend as the `find_credentials`
  Tauri command.
- `src-tauri/src/loki.rs` — fetches the full player state (roster, resources,
  expeditions board, ...), exposed as the `fetch_player_data` command. Each outbound request has
  a 20s timeout so a stalled connection fails instead of hanging forever. Device/hardware
  fingerprint fields are intentionally left as generic fake values.
- **macOS and Windows** — credential auto-discovery is implemented for both. Other platforms
  (e.g. Linux) aren't implemented.

### Frontend (`src/`)

- **React 19** + **TypeScript**, built with **Vite**, styled with **Tailwind CSS v4**
  (`@tailwindcss/vite`, CSS-first config — no `tailwind.config.js`).
- `src/main.tsx` / `src/App.tsx` — entry point and top-level layout. `GO` fetches player data
  (each RPC has its own timeout plus a countdown spinner) and renders the board immediately, then
  runs the assignment solver in a background Web Worker so the UI never blocks — the board is
  shown but disabled, under its own spinner overlay, until a suggestion (or a clear failure
  message) comes back. The environment switcher, the table view, and the Characters/Machines of
  War tabs are hidden by default (debug-only) — press "8" to reveal them.
- `src/components/` — presentational `.tsx` components (tables, cards, icon helpers, tabs,
  toggles, status indicators).
- `src/api/` — Tauri `invoke` calls (wrapped with a per-call timeout, see `invoke-with-timeout.ts`)
  and shared types.
- `src/board/board-solver.ts` — the suggested-assignment solver: builds a mixed-integer program
  (via `javascript-lp-solver`) over the open boards and available roster, solved in sequential
  lexicographic passes (bonus-resource priority, then XP earned, then boards run, then maximizing
  the total character power used) - each pass locks in the previous one's optimum before
  optimizing the next tier. Runs inside `board-solver.worker.ts` (a Web Worker) so a hard instance
  can't freeze the UI; each pass is time-boxed and checked for integrality, falling back to the
  last fully-valid pass (with a warning) or, if nothing usable was found at all, clearing the
  suggestions and telling the user to fill that board in manually.
- `src/characters/character-power.ts` — computes each unit's real in-game power from a player's raw
  API response plus a trimmed slice of Snowprint's GameConfig, matching the game's own formula.
  Characters use the full health/damage/crit/block + active/passive/relic ability + trait/movement
  formula; Machines of War (`calculateUnitPowers`, which also returns a `type`) use only their
  primary/secondary/mythic ability power. This is what the solver above uses to rank characters,
  instead of the coarser `rank` field. See "Updating character-power data" below for how its
  bundled GameConfig data gets refreshed.
- `src/board/`, `src/characters/`, `src/rank/`, `src/rarity/`, `src/progression/`, `src/factions/`
  — pure `.ts` logic: decoding raw save-data fields (`progressionIndex`, `rank`, ...) into
  domain enums, resolving game-data ids (traits, damage profiles, factions, portraits, ...) to
  the matching asset URL, and view-model functions that turn raw API data into plain objects
  ready for a component to render.
- `src/assets/` — game data (`character-data.json`, `ability-data.json`, `mow-data.json`,
  `operations-data.json` for human-readable operation names, `character-power-*.json` for the
  power calculator above) and icon/portrait images, checked into the repo.

### Building and running

```sh
npm install          # install frontend deps (also fetches the Rust deps on first Tauri run)
npm run tauri dev     # run the app in dev mode (hot-reloading webview + Tauri backend)
npm run tauri build   # produce a release build/installer
```

`npm run dev` / `npm run build` alone only run the Vite frontend (useful for quick UI iteration or
`tsc`/build verification) — they don't start the Tauri window or backend commands, so `find_credentials`
and `fetch_player_data` won't be available; use the `tauri` scripts above to run the full app.

### Building for distribution

`npm run tauri build` produces a native installer for whatever OS you run it on — e.g. on macOS
that's `src-tauri/target/release/bundle/macos/tacops.app` and a `.dmg`; on Windows it's a `.msi`
and an NSIS `.exe` under the equivalent `bundle/` folders. It only builds for the host you're
running it on — Tauri doesn't support cross-compiling to another OS without extra toolchains, and
that path is fragile enough that it isn't set up here.

To get a build for the *other* OS without owning that hardware, use the GitHub Actions workflows:
[`.github/workflows/build-macos.yml`](.github/workflows/build-macos.yml) and
[`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml). Both build natively
on GitHub-hosted runners (macOS builds both `aarch64` and `x86_64` as separate installers, Windows
builds the native MSI/NSIS installers) and run one of two ways:

- **Publish a GitHub Release** through the normal UI (any tag, any notes) — both workflows fire
  automatically and attach their installers directly to that release once they finish building.
- **Run a workflow manually** from the Actions tab — builds the same way, but creates/updates its
  own separate draft release (tag `app-v<version>`) instead of targeting one you've already
  published.

### Updating character-power data

`src/characters/character-power.ts` computes power from three small JSON files bundled at
`src/assets/character-power-{units,items,upgrades}.json` — a trimmed slice of Snowprint's
GameConfig, not the full ~18 MB document (the `units` slice carries `lineup`, the
`heroProgressionSteps*` tables including `heroProgressionStepsMoW` for Machines of War, and the
`abilityPowerCurve` / `*Modifiers` maps). Because the calculation is version-sensitive (it throws
if the response contains a unit the bundled config doesn't know about), these need re-extracting
whenever a new GameConfig ships, i.e. every game patch. There's no extraction script in this repo
for that anymore — it's the `character_power` job in `datamine_tacticus`'s `extract_all.ts`, run
from a `datamine_tacticus` checkout:

```sh
npx tsx extract_all.ts character_power --gameconfig <path-to-GameConfig.json> --output-dir <path-to-tacops>/src/assets
```

This overwrites the three `src/assets/character-power-*.json` files here and prints each one's
size — worth a glance to make sure nothing ballooned unexpectedly.

**Use the current live/public GameConfig only.** Datamine repos (e.g. `datamine_tacticus`) often
carry a newer, still-embargoed snapshot alongside the live one — don't extract from whichever
directory happens to be newest, extract from the one that matches what's actually shipped to
players. Using an embargoed or otherwise-ahead-of-release config here would both leak unreleased
content into a checked-in file and quietly compute the wrong power for players still on the live
build.

### Updating the bundled sector map

The crusade sector map layout (planet positions and adjacency) only appears in a logged-in
`GET_PLAYER` response, so the logged-out home page uses a snapshot bundled at
`src/assets/sector-map.json` instead. If the layout ever changes (e.g. a new crusade season adds or
moves planets), regenerate it from the "Export JSON" file of a logged-in session:

```sh
npx vite-node scripts/extract-sector-map.ts "<path-to-tacops-prod-player-data.json>"
```

### Credentials

TacOps doesn't manage login — it reads the credentials the actual Tacticus game client already
wrote to disk. Which file it reads depends on the OS:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/com.snowprintstudios.tacticus/live-loki_user_data.json` |
| Windows | `%USERPROFILE%\AppData\LocalLow\Snowprint\Warhammer 40,000_ Tacticus\live-loki_user_data.json` |

This file needs at least `userId` and `clientSecret`; `snowId` is used when present.

## Web version

TacOps also ships as a website, sharing the same `src/` React codebase as the desktop app rather
than being a separate project - `isTauri()` (`@tauri-apps/api/core`) picks the transport at
runtime:

- **Credentials**: the desktop app auto-discovers them from disk (see above); the website instead
  shows a `userId`/`clientSecret` form above the `GO` button (`App.tsx`), with `autoComplete`
  attributes set so the browser's own password manager can offer to remember them. Nothing is
  stored server-side - each visit starts blank unless the browser fills it in.
- **Fetching player data**: the desktop app calls `fetch_player_data` in `src-tauri/src/loki.rs`
  directly; a browser can't do that itself (the game's API doesn't send CORS headers), so the
  website instead calls a same-origin route at `/api/fetch-player-data`, handled by the Worker
  script in `worker/index.ts` (backed by `worker/loki-client.ts`) that replays the identical
  APP_START → CONNECT → GET_PLAYER handshake server-side and returns the same JSON shape - kept in
  sync with `loki.rs` by hand, since Tauri commands and a Cloudflare Worker can't share Rust/TS
  code directly.
- **Hosting**: a [Cloudflare Worker with static assets](https://developers.cloudflare.com/workers/static-assets/)
  serves both the built frontend (`dist/`, via the `[assets]` block in `wrangler.toml`) and the
  proxy (`worker/index.ts`) from one project, one domain - Cloudflare serves a matching static
  file first for any request, falling through to the Worker script only for `/api/fetch-player-data`,
  so the frontend's calls to its own proxy are same-origin and need no CORS configuration of their
  own. The Cloudflare dashboard's own GitHub integration (Workers & Pages → Create application →
  connect the repo) auto-deploys on every push to `master`, so there's no separate GitHub Actions
  workflow for this - build command `npm run build`, deploy command `npx wrangler deploy`.
- **Background crusade poller**: a 1-minute Cron Trigger (`[triggers]` in `wrangler.toml`) runs
  `worker/poller.ts`'s `scheduled()` handler, which polls the game on its own service account
  (`POLLER_USER_ID`/`POLLER_CLIENT_SECRET`) and caches the results in D1 (`worker/crusade-cache.ts`
  serves that cache at `/api/crusade-cache`) - this is what powers the read-only crusade view
  anonymous visitors see. Those two secrets need to be set once against the deployed Worker with
  `wrangler secret put POLLER_USER_ID`/`wrangler secret put POLLER_CLIENT_SECRET` - the dashboard's
  Git-integration auto-deploy doesn't run this for you, but secrets persist across later
  auto-deploys once set. For local dev, copy `.dev.vars.example` to `.dev.vars` (gitignored) and
  fill in the same two values.
- **Local dev**: `npm run worker:dev` builds the frontend and runs `wrangler dev`, serving the
  built assets and `/api/fetch-player-data` together locally (no Vite hot-reload in this mode -
  use plain `npm run dev` for frontend-only iteration).

## Style requirements

See [AGENTS.md](AGENTS.md) — this section is the canonical source; AGENTS.md just points here so
the rules only live in one place.

- Use Tailwind CSS for styling instead of hand-written stylesheets, unless there's a really good
  reason not to.
- Layout/rendering code goes in `.tsx` files. Logic goes in `.ts` files. No exceptions.

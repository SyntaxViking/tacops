# Public Discord alert when a Domination planet is about to flip

## Context

The user wants a heads-up before a Crusade Domination planet gets captured, so ranked players don't
miss the window to act on it. The design went through a few iterations in discussion:

1. Per-user email, personalized to "planets you're ranked on" - investigated and found infeasible
   without a real architecture change: this app only ever knows ONE account's personal rank (the
   background poller's own fixed `POLLER_USER_ID`/`POLLER_CLIENT_SECRET` identity) - every other
   user's raw game credentials are deliberately never stored server-side (preferences only ever
   store a SHA-256 hash, never the secret itself - `src/api/user-preferences.ts`,
   `migrations/0002_create_user_preferences_table.sql`), and the poller's own shared cache
   explicitly strips `myRank`/`myPoints` before any visitor sees it
   (`src/api/crusade-cache-seed.ts`'s `stripMyRank()`) specifically so one person's placement never
   leaks onto a page everyone else loads.
2. Tauri app (which DOES have each user's own live, personal data) pings the Worker with a Discord
   ID to notify - dropped in favor of something simpler.
3. **Final design, confirmed with the user**: a single **public** Discord channel gets a plain
   message whenever ANY Domination planet is projected to flip within 20 minutes - no per-user
   targeting, no Discord IDs, no credentials, nothing personal ever touches the server for this
   feature. Anyone who cares can watch the channel and check if it affects them. This also means
   the alert isn't actually about "planets a specific user is ranked on" anymore - every Domination
   planet matters to *someone's* rank, so (confirmed with the user) it fires for every planet, with
   no participant-count threshold to tune.

This drops the credential/auth/abuse-prevention questions entirely (nothing public-facing is added
- no new endpoint) and lets the existing background poller do the whole thing, since it already
evaluates every Domination planet's state on its own ~5-minute cadence.

**Not yet decided**: the Discord webhook itself - the user is still exploring feasibility and will
set up the server/channel/webhook URL later. This plan is written so implementation can start
immediately once that URL exists (added as a Worker secret), without blocking on it now.

## Design

Entirely server-side, inside the existing checkpointed poller (`worker/poller.ts`) - no new public
endpoint, no new client UI, no per-user data of any kind.

### 1. A new "closing soon" check, reusing existing pure logic

`src/crusade/planet-tracker-view-model.ts` already has everything needed per side:
`computeHourlyAccruedRate` (rate) and the `pointsRemaining` concept already used by
`captureUrgency`'s 1h/2h/4h buckets. Add one more small pure function alongside `captureUrgency`,
rather than overloading its existing color-coding buckets (different purpose: this is a single
yes/no decision, not a UI color tier):

```ts
const CLOSING_SOON_MINUTES = 20;

// Whichever side is closer to capture (same "whichever side is closer" convention as
// computeCaptureRace in crusade-domination-view-model.ts), projected at the current hourly rate.
export function isClosingSoon(pointsRemaining: number, hourlyRate: number): boolean {
  if (hourlyRate <= 0 || pointsRemaining <= 0) return false;
  return (pointsRemaining / hourlyRate) * 60 <= CLOSING_SOON_MINUTES;
}
```

Called twice per planet per poller step (imperial side, devastation side) - fires if EITHER side
qualifies, matching the "either side closing" behavior confirmed with the user.

### 2. Hook point: `worker/poller.ts`'s `"planets"` phase step

Confirmed via investigation: `runOneStep`'s planets-phase branch already has the full
`CrusadePlanet` (via `rawPlanetToCrusadePlanet`) in memory, including `pointsFor`/`pointsAgainst`/
`struggleData` - enough to call `computeConquestProgress` directly (already imported transitively).

The per-planet historical samples needed for `computeHourlyAccruedRate` are ALSO already fetched
and parsed inside `worker/planet-history.ts`'s `buildHistoryUpsertStatement` (it does its own
`SELECT samples, last_sunk FROM planet_history_cache WHERE planet_id = ?` and parses the JSON) -
but that data is a local variable there today, not returned to the caller. Smallest change:
**extend `buildHistoryUpsertStatement`'s return value** to also hand back the `updated` entry (or
just `updated.samples`) it already computed, so `runOneStep` can run `computeHourlyAccruedRate`
against it without a second D1 read. (A second read would also be fine resource-wise - D1 queries
don't count against the 50-subrequest/tick fetch cap that caused the earlier `exceededResources`
incident, only real fetches do - but reusing what's already in memory is simpler and strictly
cheaper.)

### 3. Dedup - don't re-fire every tick while still within the window

No existing KV/dedup mechanism in this codebase (confirmed - no KV namespace bound at all). Mirror
the existing `lastSunk`/`isEraReset` pattern already on `planet_history_cache`
(`worker/planet-history.ts`): add one nullable column, `notified_closing_at INTEGER`, to the same
table via a new migration (`migrations/0009_add_closing_notification_flag.sql` - 0009 is the next
free number). Set it (to the current tick's `nowMs`) the moment a notification fires; clear it back
to `NULL` on the same era-reset transition that already clears other per-era state (`isEraReset`'s
`sunk -> trackable` flip). `runOneStep` only fires the webhook when `isClosingSoon` is true AND
`notified_closing_at IS NULL` for that planet's current era - one notification per planet per
era/capture-cycle, not one per minute for the whole 20-minute window.

### 4. Sending the Discord message

A single `fetch()` POST to a Discord webhook URL, stored as a Worker secret (`wrangler secret put
DISCORD_WEBHOOK_URL`) once the user has one - no API client/library needed, Discord webhooks accept
a plain `POST {"content": "..."}` with no auth header beyond the URL itself being the secret.
Message is intentionally generic/public (no personal data): something like
`⚠️ <Planet Name> is projected to flip in ~<N> minutes (<Imperial|Devastation> closing in).`
Costs exactly one additional subrequest per *qualifying* planet per tick (not per planet per tick -
only planets newly crossing into the 20-minute window and not yet notified this era), so this adds
negligible load against the existing ~45/50 fetch budget per invocation.

### Files touched

- `src/crusade/planet-tracker-view-model.ts` - add `isClosingSoon` (+ its own small test file
  addition, same pattern as `captureUrgency`'s tests).
- `worker/planet-history.ts` - extend `buildHistoryUpsertStatement`'s return shape; add the
  `notified_closing_at` read/write/clear logic alongside the existing `lastSunk` handling.
- `worker/poller.ts` - in the `"planets"` phase step, after building the row: compute
  `computeConquestProgress`, run `isClosingSoon` per side against the reused samples, and (if
  qualifying + not yet notified this era) include a Discord webhook POST in that step's work.
- `migrations/0009_add_closing_notification_flag.sql` - new, adds the one column.
- `wrangler.toml` - no changes needed (a secret, not a binding, carries the webhook URL).

## Verification

- `npx tsc --noEmit` and `npm test` for `isClosingSoon` (boundary cases: exactly 20 min, just over,
  non-positive rate, already-captured) and any updated `planet-history.test.ts`/`poller.test.ts`
  coverage for the new column's read/write/clear behavior.
- Can't be verified end-to-end without a real Discord webhook URL and a live deploy (per
  `AGENTS.md`, no dev server) - once the user has a webhook, a direct `curl -X POST` to it is a
  good first smoke test before wiring it into the poller, and watching a real near-capture planet
  (or a short-TTL manual test row) through one poller cycle confirms the dedup logic doesn't
  double-fire.

## Still open (deferred until the user is ready to implement)

- The actual Discord server/channel/webhook URL - the user is exploring feasibility for now and
  will set this up later; I'll walk them through creating it when they're ready.

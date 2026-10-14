// The game's own daily server reset/rollover happens around UTC midnight - hammering a real
// account's session with requests close to that time has caused account issues. This is the one
// source of truth for the resulting cooldown window (23:50 UTC to 00:10 UTC), imported directly by
// both the client (modal countdown, transport gate - see rollover-guard.ts/invoke-with-timeout.ts)
// and the Worker (route rejection in worker/index.ts, poller bail-out in worker/poller.ts), same
// precedent as src/crusade/crusade-domination-view-model.ts already being imported into worker/*.ts
// - pure Date math, no browser/Tauri/Worker-specific APIs, safe everywhere.
const WINDOW_START_MS_OF_DAY = (23 * 60 + 50) * 60 * 1000; // 23:50 UTC
const WINDOW_END_MS_OF_DAY = 10 * 60 * 1000; // 00:10 UTC
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isInRolloverWindow(nowMs: number): boolean {
  const msOfDay = nowMs % MS_PER_DAY;
  return msOfDay >= WINDOW_START_MS_OF_DAY || msOfDay < WINDOW_END_MS_OF_DAY;
}

// 0 when not currently in the window - callers that already checked isInRolloverWindow can treat
// this as "time remaining," everyone else should check isInRolloverWindow first.
export function msUntilRolloverWindowEnds(nowMs: number): number {
  const msOfDay = nowMs % MS_PER_DAY;
  if (msOfDay < WINDOW_END_MS_OF_DAY) return WINDOW_END_MS_OF_DAY - msOfDay;
  if (msOfDay >= WINDOW_START_MS_OF_DAY) return MS_PER_DAY - msOfDay + WINDOW_END_MS_OF_DAY;
  return 0;
}

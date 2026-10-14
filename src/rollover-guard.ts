import { isInRolloverWindow } from "./rollover-window";

// Installed once at app startup (imported for its side effect in main.tsx, before anything else
// runs) - wraps the global fetch so every current *and future* fetch()-based call site is covered
// automatically, rather than needing the rollover check patched into each of the many bespoke
// fetch wrappers scattered across src/api/*.ts (fetch-crusade-cache.ts, fetch-planet-history.ts,
// user-preferences.ts, track-usage.ts, version-check.ts, board-layout.ts's web path, plus
// fetch-with-timeout.ts itself) - easy to regress if a ninth one gets added later and the check is
// only in the first eight. The Tauri equivalent (invoke()) isn't a true global, so that side is
// gated inside invoke-with-timeout.ts instead - see that file's own comment.
//
// Deliberately does NOT cover plain browser-native resource loads (e.g. <img src=...> for board
// art) - those aren't authenticated account traffic, just static CDN assets, so they're not part
// of the account-hammering risk this guards against (confirmed with the user).
const originalFetch = window.fetch.bind(window);

window.fetch = (...args: Parameters<typeof fetch>) => {
  if (isInRolloverWindow(Date.now())) {
    return Promise.reject(new Error("Blocked: game-server rollover cooldown window (23:50-00:10 UTC) - no account traffic is sent during this time."));
  }
  return originalFetch(...args);
};

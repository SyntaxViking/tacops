// Detects when a newer build has been deployed while this page is still open, so a stale tab can
// be forced to reload rather than keep running old client logic indefinitely (e.g. an old tracker
// loop without the current rate limiting - see App.tsx's TRACKER_WEB_MIN_INTERVAL_MS). Costs
// nothing on its own: re-fetching "/" is served straight from Cloudflare's static [assets] cache,
// never reaching the Worker's own fetch handler (same reasoning as every other static asset - see
// worker/index.ts's own header comment), so polling it doesn't add any Workers load itself.
//
// Vite content-hashes the main bundle's filename on every build (main-<hash>.js) - comparing that
// filename is a simpler, zero-extra-infrastructure staleness signal than stamping and serving a
// separate version number, and it's exactly the file whose *content* (including this rate limit)
// is what we actually care about being current.
const MAIN_SCRIPT_PATTERN = /\/assets\/main-[\w-]+\.js/;

// Pure and independently testable - the actual page-reading/fetch/interval glue below is not (same
// convention as this repo's other fetch/DOM-touching code, e.g. fetch-crusade-cache.ts).
export function extractMainScriptSrc(html: string): string | null {
  return html.match(MAIN_SCRIPT_PATTERN)?.[0] ?? null;
}

function currentMainScriptSrc(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[src*="/assets/main-"]');
  return script?.getAttribute("src") ?? null;
}

// Polls "/" every intervalMs and calls onStale (once) the first time the deployed main bundle's
// filename differs from the one this page itself loaded - i.e. a new build has shipped since this
// tab was opened. Returns a cleanup function for a useEffect. A failed check (offline, timeout) is
// silently ignored and retried next interval - never treated as staleness.
export function startVersionCheck(onStale: () => void, intervalMs: number): () => void {
  const loadedScriptSrc = currentMainScriptSrc();
  let stopped = false;

  async function check() {
    if (loadedScriptSrc === null) return; // couldn't determine our own version - nothing to compare against
    try {
      const res = await fetch("/", { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.text();
      const deployedScriptSrc = extractMainScriptSrc(html);
      if (deployedScriptSrc && deployedScriptSrc !== loadedScriptSrc && !stopped) {
        stopped = true;
        onStale();
      }
    } catch {
      // Offline or a transient fetch failure - try again next interval, don't treat as staleness.
    }
  }

  const intervalId = setInterval(() => {
    if (!stopped) void check();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

// A second, independent staleness signal: the server itself (worker/client-version.ts) rejects
// any /api/fetch-* call whose client is too old with HTTP 426, before doing any work - checked at
// src/api/fetch-with-timeout.ts, which calls reportStaleVersion() the moment that happens. This is
// what actually protects a tab that's *already open right now*, running JS from before
// startVersionCheck (or even this file) existed - that old code can't poll for its own staleness,
// but any request it makes still gets a 426 the instant the server's minimum is raised, and (once
// this feature itself has shipped) that triggers this same handler. Module-level rather than
// threaded through every call site, since there's exactly one handler (App.tsx's
// StaleVersionBanner) for the whole app.
let staleVersionHandler: (() => void) | null = null;

export function registerStaleVersionHandler(handler: () => void): void {
  staleVersionHandler = handler;
}

export function reportStaleVersion(): void {
  staleVersionHandler?.();
}

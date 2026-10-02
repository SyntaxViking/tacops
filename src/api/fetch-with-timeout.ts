import { API_VERSION } from "../api-version";
import { reportStaleVersion } from "../version-check";

// fetch()-based analog to invoke-with-timeout.ts's invokeWithTimeout, for the web build's calls
// to our own Cloudflare Pages Function proxy instead of a Tauri invoke.
//
// Every call automatically carries this build's API_VERSION - the server (worker/index.ts,
// worker/client-version.ts, importing that exact same constant) rejects any request whose
// apiVersion is missing or below its own minimum with HTTP 426, before doing any work at all.
// That's the mechanism that stops a stale tab (including one already open right now, running JS
// from before this field even existed) from keep hammering the backend with old behavior - see
// reportStaleVersion below, which surfaces App.tsx's StaleVersionBanner the moment that happens.
// API_VERSION itself only changes on a deliberate breaking change (see its own comment) - most
// deploys ship with it unchanged, so this field being present doesn't by itself force a refresh.
export async function fetchWithTimeout<T>(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const bodyWithVersion = { ...body, apiVersion: API_VERSION };
  const res = await Promise.race([
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyWithVersion),
    }),
    new Promise<Response>((_, reject) => {
      setTimeout(() => reject(new Error(`"${url}" timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    }),
  ]);

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 426) reportStaleVersion();
    throw new Error(data?.error ?? `"${url}" returned HTTP ${res.status}`);
  }
  return data as T;
}

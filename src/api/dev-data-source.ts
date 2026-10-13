import { isTauri } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./invoke-with-timeout";

// Tauri-only dev convenience: lets the desktop app read the Worker's own D1-backed endpoints
// (planet history, the crusade-cache snapshot, saved preferences) from the live deployed site
// instead of a local D1 the developer doesn't have running - without this, those endpoints are
// always empty in a local Tauri build, since fetchPlayerData/fetchCrusadeData already bypass the
// Worker entirely (straight to Loki via Rust), but these three never had a Tauri-side equivalent.
// Meaningless on the web build (always "local" there - the web app already *is* the Worker, so
// there's no separate "production" to switch to).
export type DevDataSource = "local" | "production";

const STORAGE_KEY = "tacops.devDataSource";

export function getDevDataSource(): DevDataSource {
  if (!isTauri()) return "local";
  try {
    return localStorage.getItem(STORAGE_KEY) === "production" ? "production" : "local";
  } catch {
    return "local";
  }
}

export function setDevDataSource(source: DevDataSource): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // Best-effort - worst case the toggle doesn't persist across restarts.
  }
}

export function shouldUseProductionDataSource(): boolean {
  return isTauri() && getDevDataSource() === "production";
}

// A plain cross-origin fetch() to the deployed Worker from inside the Tauri webview hits a CORS
// failure (confirmed: worker/index.ts sets no Access-Control-Allow-Origin header on any /api/*
// route, same root cause board_assets.rs's fetch_spawn_points command already works around) - so
// this routes through Rust/reqwest instead, which has no such restriction, exactly like that
// existing command. `path` is a Worker-relative path, e.g. "/api/planet-history-all".
export function proxyWorkerGet<T>(path: string, timeoutMs: number): Promise<T> {
  return invokeWithTimeout<T>("proxy_worker_get", { path }, timeoutMs);
}

export function proxyWorkerPost<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  return invokeWithTimeout<T>("proxy_worker_post", { path, body }, timeoutMs);
}

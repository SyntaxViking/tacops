import { isTauri } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "../api/invoke-with-timeout";

// board-assets/ is deliberately NOT bundled into the app build (see the implementation plan's
// "Board image hosting") - wrangler.toml's [assets] directory and tauri.conf.json's frontendDist
// both point at the same dist/ folder, so anything bundled there ships in both the web deploy AND
// the desktop installer. These boards are large enough (14MB for all 69) that bundling them into
// the installer wasn't worth it, so they're deployed as plain static files alongside dist/ instead
// and fetched over the network at runtime by both transports - the same network dependency this
// feature already has for GET_PVP_STATE itself.
export const BOARD_ASSET_ORIGIN = "https://tacops.cpunerd.workers.dev";

export function boardImageUrl(boardId: string): string {
  return `${BOARD_ASSET_ORIGIN}/boards/${boardId}_Visual.png`;
}

// Dev-only fallback (Tauri only - the web build has no local filesystem to fall back to and just
// always hits the live Worker) so newly-extracted Arena/Onslaught board art can be checked before
// it's actually deployed there. Reads board-assets/boards/<boardId>_Visual.png straight off disk
// via the read_local_board_image Rust command; resolves null (not a throw) both when running on
// the web and when the file simply isn't there locally yet - either way the caller should just
// fall back to showing its usual "failed to load" state.
export function localBoardImageDataUrl(boardId: string): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(null);
  return invokeWithTimeout<string | null>("read_local_board_image", { boardId }, 10_000);
}

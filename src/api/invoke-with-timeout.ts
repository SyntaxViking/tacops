import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { isInRolloverWindow } from "../rollover-window";

export const DEFAULT_RPC_TIMEOUT_MS = 20_000;

// Only these commands reach the GAME's own servers on a real account's credentials (the other
// invoke() commands this app has - find_credentials/read_local_board_image/write_text_file are
// local-disk-only, fetch_spawn_points/proxy_worker_get/proxy_worker_post hit tacops's own Worker,
// never the game) - so only these are blocked during the rollover cooldown window. Gating every
// command uniformly would also break things with zero account risk (exporting data to a local
// file, viewing Arena spawn-point overlays) for no safety benefit. fetch_player_data/
// fetch_crusade_data/fetch_leaderboard_data/fetch_pvp_state proxy directly to the game's Loki
// servers via Rust reqwest; guild_feed_init/read_channel_window/upload_replay open a raw TLS
// socket straight to the game's own Loki/game-event servers (see src-tauri/src/guild_chat.rs).
const ROLLOVER_GATED_COMMANDS = new Set([
  "fetch_player_data",
  "fetch_crusade_data",
  "fetch_leaderboard_data",
  "fetch_pvp_state",
  "guild_feed_init",
  "read_channel_window",
  "upload_replay",
]);

// A hung command (e.g. a stalled network request on the Rust side) would otherwise leave the
// frontend waiting forever - this makes sure the UI always gets an answer within timeoutMs, even
// though the underlying command keeps running until it naturally finishes.
export async function invokeWithTimeout<T>(
  command: string,
  args?: InvokeArgs,
  timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
): Promise<T> {
  if (ROLLOVER_GATED_COMMANDS.has(command) && isInRolloverWindow(Date.now())) {
    throw new Error("Blocked: game-server rollover cooldown window (23:50-00:10 UTC) - no account traffic is sent during this time.");
  }
  return Promise.race([
    invoke<T>(command, args),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`"${command}" timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    }),
  ]);
}

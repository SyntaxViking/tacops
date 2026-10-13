import { isTauri } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./invoke-with-timeout";
import { fetchWithTimeout } from "./fetch-with-timeout";
import type { Credentials, Environment, RawPvpState } from "./types";

// Both transports replay APP_START -> CONNECT -> GET_PVP_STATE server-side, same shape as
// fetchCrusadeData - see fetch-crusade-data.ts. playerPosition comes from the ordinary GET_PLAYER
// call (PlayerResources.pvpPosition) - the caller resolves that itself rather than this module
// re-deriving it.
export async function fetchPvpState(
  environment: Environment,
  playerPosition: number,
  webCredentials?: { userId: string; clientSecret: string },
): Promise<RawPvpState> {
  const response = isTauri()
    ? await (async () => {
        const credentials = await invokeWithTimeout<Credentials>("find_credentials", { environment }, 20_000);
        return invokeWithTimeout<any>("fetch_pvp_state", { environment, ...credentials, playerPosition }, 60_000);
      })()
    : await fetchWithTimeout<any>(
        "/api/fetch-pvp-state",
        { environment, ...webCredentials, snowId: "", playerPosition },
        60_000,
      );

  return response?.eventResults?.[0]?.eventResponseData?.pvpState;
}

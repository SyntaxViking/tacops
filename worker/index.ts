import { fetchCrusadeDataFromLoki, fetchLeaderboardDataFromLoki, fetchPlayerDataFromLoki, fetchPvpStateFromLoki } from "./loki-client";
import { recordSighting } from "./track";
import { renderInsightsPage } from "./insights";
import { getUserPreferences, setUserPreferenceColumn } from "./user-preferences";
import { getCrusadeCache } from "./crusade-cache";
import { getLeaderboardCache } from "./leaderboard-cache";
import { getAllPlanetHistory, getPlanetHistory } from "./planet-history";
import { runPollerTick } from "./poller";
import { isClientVersionAcceptable, STALE_CLIENT_MESSAGE } from "./client-version";
import { isInRolloverWindow, msUntilRolloverWindowEnds } from "../src/rollover-window";

interface Env {
  DB: D1Database;
  POLLER_USER_ID: string;
  POLLER_CLIENT_SECRET: string;
  // Gates /debug/poller-identity below - a fixed, generated UUID (not a per-user secret), set the
  // same way as the poller creds (`wrangler secret put DEBUG_SECRET`). Required because that route
  // makes a real, account-authenticated GET_PLAYER call on the poller's own credentials - without
  // this gate, anyone who found the URL could trigger that call for free.
  DEBUG_SECRET: string;
}

interface RequestBody {
  environment: string;
  userId: string;
  clientSecret: string;
  snowId?: string;
  // src/api-version.ts's API_VERSION, merged into every request body automatically by
  // src/api/fetch-with-timeout.ts - absent entirely on any client that predates this field.
  apiVersion?: number;
}

interface LeaderboardRequestBody extends RequestBody {
  leaderboardIds: string[];
}

interface PvpStateRequestBody extends RequestBody {
  playerPosition: number;
}

interface TrackRequestBody {
  userHash: string;
}

interface GetPreferencesRequestBody {
  userHash: string;
}

interface SetPreferenceRequestBody {
  userHash: string;
  secretHash: string;
  ids: string[];
}

// 426 Upgrade Required - semantically "the server refuses to proceed with the current client,
// upgrade (reload) to continue". Shared across every /api/fetch-* route below.
const STALE_CLIENT_RESPONSE = () => Response.json({ error: STALE_CLIENT_MESSAGE }, { status: 426 });

// 503 Service Unavailable + Retry-After - the standard HTTP convention for "deliberately not
// serving you right now, try later" (more semantically correct here than reusing 426, which is
// specifically about client-version mismatch). Only applied to the 4 routes below that actually
// proxy a live call to the game's own servers on a real account's credentials - the other routes
// here only ever read/write tacops's own D1 cache and never touch the account, so gating them
// would degrade unrelated public/cached functionality for no safety benefit.
// Any NEW route added here that makes a live call to the game's own servers must get this same
// check - see AGENTS.md.
const ROLLOVER_WINDOW_RESPONSE = (nowMs: number) =>
  Response.json(
    { error: "Game-server reset window is in progress - TacOps isn't sending account traffic right now. Try again in a few minutes." },
    { status: 503, headers: { "Retry-After": String(Math.ceil(msUntilRolloverWindowEnds(nowMs) / 1000)) } },
  );

// Cloudflare serves a matching file out of the [assets] directory before this Worker ever runs
// (the default when both `main` and `[assets]` are configured), so this only needs to handle the
// routes that aren't static files - everything else falling through here is a genuine 404.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/fetch-player-data" && request.method === "POST") {
      const body = (await request.json()) as RequestBody;
      if (isInRolloverWindow(Date.now())) return ROLLOVER_WINDOW_RESPONSE(Date.now());
      if (!isClientVersionAcceptable(body.apiVersion)) return STALE_CLIENT_RESPONSE();
      try {
        const data = await fetchPlayerDataFromLoki(
          body.environment,
          body.userId,
          body.clientSecret,
          body.snowId ?? "",
        );
        return Response.json(data);
      } catch (error) {
        return Response.json({ error: `${error}` }, { status: 502 });
      }
    }

    if (url.pathname === "/api/fetch-crusade-data" && request.method === "POST") {
      const body = (await request.json()) as RequestBody;
      if (isInRolloverWindow(Date.now())) return ROLLOVER_WINDOW_RESPONSE(Date.now());
      if (!isClientVersionAcceptable(body.apiVersion)) return STALE_CLIENT_RESPONSE();
      try {
        const data = await fetchCrusadeDataFromLoki(body.environment, body.userId, body.clientSecret, body.snowId ?? "");
        return Response.json(data);
      } catch (error) {
        return Response.json({ error: `${error}` }, { status: 502 });
      }
    }

    if (url.pathname === "/api/fetch-pvp-state" && request.method === "POST") {
      const body = (await request.json()) as PvpStateRequestBody;
      if (isInRolloverWindow(Date.now())) return ROLLOVER_WINDOW_RESPONSE(Date.now());
      if (!isClientVersionAcceptable(body.apiVersion)) return STALE_CLIENT_RESPONSE();
      try {
        const data = await fetchPvpStateFromLoki(
          body.environment,
          body.userId,
          body.clientSecret,
          body.snowId ?? "",
          body.playerPosition,
        );
        return Response.json(data);
      } catch (error) {
        return Response.json({ error: `${error}` }, { status: 502 });
      }
    }

    if (url.pathname === "/api/fetch-leaderboard-data" && request.method === "POST") {
      const body = (await request.json()) as LeaderboardRequestBody;
      if (isInRolloverWindow(Date.now())) return ROLLOVER_WINDOW_RESPONSE(Date.now());
      if (!isClientVersionAcceptable(body.apiVersion)) return STALE_CLIENT_RESPONSE();
      try {
        const data = await fetchLeaderboardDataFromLoki(
          body.environment,
          body.userId,
          body.clientSecret,
          body.snowId ?? "",
          body.leaderboardIds,
        );
        return Response.json(data);
      } catch (error) {
        return Response.json({ error: `${error}` }, { status: 502 });
      }
    }

    if (url.pathname === "/api/crusade-cache" && request.method === "GET") {
      return Response.json(await getCrusadeCache(env.DB));
    }

    // Open/no-auth, same as /api/crusade-cache above - the shared per-planet leaderboard cache
    // (worker/poller.ts/worker/leaderboard-cache.ts) is account-agnostic data, not personal to any
    // one account, and this only ever reads tacops's own D1, never the game's servers.
    if (url.pathname === "/api/leaderboard-cache" && request.method === "GET") {
      return Response.json({ entries: await getLeaderboardCache(env.DB) });
    }

    // Open/no-auth, same as /api/crusade-cache above - a planet's own points-remaining history is
    // shared crusade data, not personal to any one account.
    if (url.pathname === "/api/planet-history" && request.method === "GET") {
      const planetId = url.searchParams.get("planetId");
      if (!planetId) return Response.json({ error: "missing planetId" }, { status: 400 });
      return Response.json({ samples: await getPlanetHistory(env.DB, planetId) });
    }

    // Bulk variant of the route above (same open/no-auth pattern) - the Monitor tab's one-shot
    // fetch of every planet's current-era history, instead of one request per planet.
    if (url.pathname === "/api/planet-history-all" && request.method === "GET") {
      return Response.json({ samples: Object.fromEntries(await getAllPlanetHistory(env.DB)) });
    }

    if (url.pathname === "/api/track" && request.method === "POST") {
      const body = (await request.json()) as TrackRequestBody;
      ctx.waitUntil(recordSighting(env.DB, body.userHash));
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/preferences/get" && request.method === "POST") {
      const body = (await request.json()) as GetPreferencesRequestBody;
      const preferences = await getUserPreferences(env.DB, body.userHash);
      return Response.json(preferences);
    }

    if (url.pathname === "/api/preferences/favorited-characters" && request.method === "POST") {
      const body = (await request.json()) as SetPreferenceRequestBody;
      const result = await setUserPreferenceColumn(env.DB, body.userHash, body.secretHash, "favorited_characters", body.ids);
      return result.ok ? new Response(null, { status: 204 }) : Response.json({ error: result.error }, { status: 403 });
    }

    if (url.pathname === "/api/preferences/favorited-planets" && request.method === "POST") {
      const body = (await request.json()) as SetPreferenceRequestBody;
      const result = await setUserPreferenceColumn(env.DB, body.userHash, body.secretHash, "favorited_planets", body.ids);
      return result.ok ? new Response(null, { status: 204 }) : Response.json({ error: result.error }, { status: 403 });
    }

    if (url.pathname === "/api/preferences/anti-favorited-characters" && request.method === "POST") {
      const body = (await request.json()) as SetPreferenceRequestBody;
      const result = await setUserPreferenceColumn(env.DB, body.userHash, body.secretHash, "anti_favorited_characters", body.ids);
      return result.ok ? new Response(null, { status: 204 }) : Response.json({ error: result.error }, { status: 403 });
    }

    if (url.pathname === "/insights" && request.method === "GET") {
      return renderInsightsPage(env.DB);
    }

    // Confirms which account the poller's configured credentials actually belong to - a real
    // GET_PLAYER call on env.POLLER_USER_ID/POLLER_CLIENT_SECRET, returning only the account's own
    // display name/power level (never the credentials themselves). Gated on DEBUG_SECRET (see Env
    // above) since this makes a real, credentialed call to the game's own servers.
    if (url.pathname === "/debug/poller-identity" && request.method === "GET") {
      if (request.headers.get("X-Debug-Secret") !== env.DEBUG_SECRET) return new Response("Not found", { status: 404 });
      if (isInRolloverWindow(Date.now())) return ROLLOVER_WINDOW_RESPONSE(Date.now());
      try {
        const data = (await fetchPlayerDataFromLoki("prod", env.POLLER_USER_ID, env.POLLER_CLIENT_SECRET, "")) as any;
        const player = data?.eventResult?.eventResponseData?.player?.hero?.player;
        return Response.json({ name: player?.name ?? null, powerLevel: player?.powerLevel ?? null });
      } catch (error) {
        return Response.json({ error: `${error}` }, { status: 502 });
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPollerTick(env.DB, env.POLLER_USER_ID, env.POLLER_CLIENT_SECRET));
  },
};

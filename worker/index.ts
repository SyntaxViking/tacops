import { fetchCrusadeDataFromLoki, fetchLeaderboardDataFromLoki, fetchPlayerDataFromLoki } from "./loki-client";
import { recordSighting } from "./track";
import { renderInsightsPage } from "./insights";
import { getUserPreferences, setUserPreferenceColumn } from "./user-preferences";
import { getCrusadeCache } from "./crusade-cache";
import { runPollerTick } from "./poller";

interface Env {
  DB: D1Database;
  POLLER_USER_ID: string;
  POLLER_CLIENT_SECRET: string;
}

interface RequestBody {
  environment: string;
  userId: string;
  clientSecret: string;
  snowId?: string;
}

interface LeaderboardRequestBody extends RequestBody {
  leaderboardIds: string[];
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

// Cloudflare serves a matching file out of the [assets] directory before this Worker ever runs
// (the default when both `main` and `[assets]` are configured), so this only needs to handle the
// routes that aren't static files - everything else falling through here is a genuine 404.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/fetch-player-data" && request.method === "POST") {
      const body = (await request.json()) as RequestBody;
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
      try {
        const data = await fetchCrusadeDataFromLoki(body.environment, body.userId, body.clientSecret, body.snowId ?? "");
        return Response.json(data);
      } catch (error) {
        return Response.json({ error: `${error}` }, { status: 502 });
      }
    }

    if (url.pathname === "/api/fetch-leaderboard-data" && request.method === "POST") {
      const body = (await request.json()) as LeaderboardRequestBody;
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

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPollerTick(env.DB, env.POLLER_USER_ID, env.POLLER_CLIENT_SECRET));
  },
};

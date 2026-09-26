import { describe, expect, it } from "vitest";
import { gameEventChecksum, looksLikeSuccess } from "./loki-client";

// Pinned against 5 real captures (2 different gameEventTypes) gathered this session - if these
// ever fail, GAME_EVENT_GAME_CONFIG_VERSION in loki-client.ts has almost certainly rotated (the
// game updated) and needs re-capturing, not a bug in this function.
describe("gameEventChecksum", () => {
  it("matches a captured GET_CRUSADE checksum", () => {
    const d = gameEventChecksum("35ba684f-adf6-4714-990e-46d24b1c9064", "GET_CRUSADE", {});
    expect(d).toBe("CAD7B986D4C0F4F2FB2A36B0B3C22652");
  });

  it("matches a captured GET_GUILD_WAR_STATUS checksum", () => {
    const d = gameEventChecksum("0204b5af-0e94-469c-a4e0-9f6ea5ebda66", "GET_GUILD_WAR_STATUS", {
      guildWarId: "cc144330-7be6-4a47-8f67-087ce739c82b",
    });
    expect(d).toBe("7E3E6C3B4E3095EF932200EFDA5961DA");
  });
});

describe("looksLikeSuccess", () => {
  it("detects the success marker near the start of a real-shaped GET_LEADERBOARD_2 response, even a huge one", () => {
    const hugeTrailer = "x".repeat(200_000); // simulates a planet with a very large leaderboards payload
    const text = `{"eventResult":{"eventId":"","eventResultType":"SUCCESS","eventResponseData":{"leaderboards":{"${hugeTrailer}":1}}}}`;
    expect(looksLikeSuccess(text)).toBe(true);
  });

  it("returns false for an application-level error response", () => {
    const text = `{"eventResult":{"eventId":"","eventResultType":"FAILURE","errorMessage":"nope"}}`;
    expect(looksLikeSuccess(text)).toBe(false);
  });

  it("returns false for garbage/empty input rather than throwing", () => {
    expect(looksLikeSuccess("")).toBe(false);
    expect(looksLikeSuccess("not json at all")).toBe(false);
  });
});

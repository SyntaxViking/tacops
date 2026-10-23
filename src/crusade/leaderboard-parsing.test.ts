import { describe, expect, it } from "vitest";
import { factionPlayerLeaderboardId, leaderboardIdsForPlanet, readLeaderboard } from "./leaderboard-parsing";

describe("leaderboardIdsForPlanet", () => {
  it("builds the four side-leaderboard ids with the right type prefixes", () => {
    expect(leaderboardIdsForPlanet("crusade_1", 2, "planet_041")).toEqual({
      factionFor: "crusadeFaction:crusade_leaderboard_planet_side_factions_crusade_1_2_planet_041_for",
      factionAgainst: "crusadeFaction:crusade_leaderboard_planet_side_factions_crusade_1_2_planet_041_against",
      playerFor: "crusadePlayer:crusade_leaderboard_planet_side_players_crusade_1_2_planet_041_for",
      playerAgainst: "crusadePlayer:crusade_leaderboard_planet_side_players_crusade_1_2_planet_041_against",
    });
  });
});

describe("factionPlayerLeaderboardId", () => {
  it("builds one id per faction, not split for/against", () => {
    expect(factionPlayerLeaderboardId("crusade_1", 2, "planet_041", "Ultramarines")).toBe(
      "crusadePlayer:crusade_leaderboard_planet_faction_players_crusade_1_2_planet_041_Ultramarines",
    );
  });
});

describe("readLeaderboard", () => {
  it("converts the API's 0-based myRank to a 1-based display rank", () => {
    const leaderboards = { "some:id": { numParticipants: 10, myRank: 0, myPoints: 500, topEntries: [], localEntries: [] } };
    expect(readLeaderboard(leaderboards, "some:id", "me")?.myRank).toBe(1);
  });

  it("leaves a null myRank (not ranked, and not present in topEntries/localEntries either) alone", () => {
    const leaderboards = { "some:id": { numParticipants: 10, myRank: null, myPoints: null, topEntries: [], localEntries: [] } };
    expect(readLeaderboard(leaderboards, "some:id", "me")?.myRank).toBeNull();
  });

  it("returns null when the leaderboard id isn't present at all (typo'd id prefix)", () => {
    expect(readLeaderboard({}, "missing:id", "me")).toBeNull();
  });

  it("derives myRank/myPoints from topEntries by participantId when the API omits myRank entirely (player already in the top entries, e.g. rank #1)", () => {
    const leaderboards = {
      "some:id": {
        numParticipants: 10,
        topEntries: [
          { position: 0, points: 7588, participantId: "me" },
          { position: 1, points: 7500, participantId: "someone-else" },
        ],
        localEntries: [],
      },
    };
    const result = readLeaderboard(leaderboards, "some:id", "me");
    expect(result?.myRank).toBe(1);
    expect(result?.myPoints).toBe(7588);
  });

  it("derives myRank/myPoints from localEntries by participantId when myRank is omitted and the player isn't in topEntries", () => {
    const leaderboards = {
      "some:id": {
        numParticipants: 50,
        topEntries: [{ position: 0, points: 9000, participantId: "someone-else" }],
        localEntries: [{ position: 12, points: 3984, participantId: "me" }],
      },
    };
    const result = readLeaderboard(leaderboards, "some:id", "me");
    expect(result?.myRank).toBe(13);
    expect(result?.myPoints).toBe(3984);
  });

  it("prefers the server-supplied myRank over a topEntries participantId match when both are present", () => {
    const leaderboards = {
      "some:id": {
        numParticipants: 10,
        myRank: 4,
        myPoints: 1234,
        topEntries: [{ position: 0, points: 7588, participantId: "me" }],
        localEntries: [],
      },
    };
    const result = readLeaderboard(leaderboards, "some:id", "me");
    expect(result?.myRank).toBe(5);
    expect(result?.myPoints).toBe(1234);
  });
});

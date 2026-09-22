import { describe, expect, it } from "vitest";
import { computeCaptureRace, computeConquestProgress, isPlanetRanked, sortDominationPlanets } from "./crusade-domination-view-model";
import type { CrusadePlanet, PlanetLeaderboard } from "../api/types";

function planet(overrides: Partial<CrusadePlanet> = {}): CrusadePlanet {
  return { planetId: "planet_001", name: "Test Planet", zone: null, ...overrides };
}

function leaderboard(overrides: Partial<PlanetLeaderboard> = {}): PlanetLeaderboard {
  return { planetId: "planet_001", topFactionsFor: [], topFactionsAgainst: [], side: null, faction: null, ...overrides };
}

const noStars = new Set<string>();

describe("computeConquestProgress", () => {
  it("returns null when the planet has no struggleData (not currently contestable)", () => {
    expect(computeConquestProgress(planet())).toBeNull();
  });

  it("measures the Imperial-owned planet's own points against the Defender threshold, the other side against Attacker", () => {
    const p = planet({
      sideOwner: "For",
      pointsFor: 50,
      pointsAgainst: 25,
      struggleData: { conquestThresholdPointsAttacker: 100, conquestThresholdPointsDefender: 200 },
    });
    expect(computeConquestProgress(p)).toEqual({
      imperialCurrent: 50,
      imperialThreshold: 200,
      imperialPercent: 25,
      devastationCurrent: 25,
      devastationThreshold: 100,
      devastationPercent: 25,
    });
  });

  it("measures the Devastation-owned planet's own points against the Defender threshold, Imperial against Attacker", () => {
    const p = planet({
      sideOwner: "Against",
      pointsFor: 30,
      pointsAgainst: 150,
      struggleData: { conquestThresholdPointsAttacker: 60, conquestThresholdPointsDefender: 300 },
    });
    expect(computeConquestProgress(p)).toEqual({
      imperialCurrent: 30,
      imperialThreshold: 60,
      imperialPercent: 50,
      devastationCurrent: 150,
      devastationThreshold: 300,
      devastationPercent: 50,
    });
  });

  it("treats absent pointsFor/pointsAgainst as 0 (no battles fought there yet)", () => {
    const p = planet({ sideOwner: "For", struggleData: { conquestThresholdPointsAttacker: 100, conquestThresholdPointsDefender: 100 } });
    const result = computeConquestProgress(p)!;
    expect(result.imperialCurrent).toBe(0);
    expect(result.devastationCurrent).toBe(0);
    expect(result.imperialPercent).toBe(0);
  });
});

describe("computeCaptureRace", () => {
  it("returns null when the planet has no struggleData", () => {
    expect(computeCaptureRace(planet())).toBeNull();
  });

  it("picks Imperial as the leading side when they need fewer points to capture", () => {
    const p = planet({
      sideOwner: "Against",
      pointsFor: 90,
      pointsAgainst: 10,
      struggleData: { conquestThresholdPointsAttacker: 100, conquestThresholdPointsDefender: 100 },
    });
    // Imperial (attacker here) needs 100-90=10 more; Devastation (defender) needs 100-10=90 more.
    expect(computeCaptureRace(p)).toEqual({ leadingSide: "Imperial", pointsRemaining: 10 });
  });

  it("picks Devastation as the leading side when they need fewer points to capture", () => {
    const p = planet({
      sideOwner: "For",
      pointsFor: 10,
      pointsAgainst: 90,
      struggleData: { conquestThresholdPointsAttacker: 100, conquestThresholdPointsDefender: 100 },
    });
    // Devastation (attacker here) needs 100-90=10 more; Imperial (defender) needs 100-10=90 more.
    expect(computeCaptureRace(p)).toEqual({ leadingSide: "Devastation", pointsRemaining: 10 });
  });
});

describe("isPlanetRanked", () => {
  it("is true when the player has a side rank", () => {
    expect(isPlanetRanked(leaderboard({ side: { numParticipants: 10, myRank: 3, myPoints: 100, benchmarks: [], referenceScore: null } }))).toBe(true);
  });

  it("is true when the player has a faction rank", () => {
    expect(isPlanetRanked(leaderboard({ faction: { numParticipants: 10, myRank: 3, myPoints: 100, benchmarks: [], referenceScore: null } }))).toBe(true);
  });

  it("is false when neither side nor faction has a rank", () => {
    expect(isPlanetRanked(leaderboard())).toBe(false);
  });

  it("is false when there's no leaderboard data at all yet", () => {
    expect(isPlanetRanked(undefined)).toBe(false);
  });
});

describe("sortDominationPlanets", () => {
  it("puts faction-ranked planets first, ordered by the selected sort mode rather than leaderboard percentile", () => {
    // "far" has a much better (lower) faction rank/percentile than "close", but "close" is nearer
    // to capture - the ranked group should still follow the sort mode, not the percentile.
    const planets = [
      planet({ planetId: "far", sideOwner: "For", pointsFor: 100, pointsAgainst: 100, struggleData: { conquestThresholdPointsAttacker: 10000, conquestThresholdPointsDefender: 10000 } }),
      planet({ planetId: "close", sideOwner: "For", pointsFor: 100, pointsAgainst: 9900, struggleData: { conquestThresholdPointsAttacker: 10000, conquestThresholdPointsDefender: 10000 } }),
      planet({ planetId: "unranked" }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>([
      ["far", leaderboard({ planetId: "far", faction: { numParticipants: 100, myRank: 5, myPoints: 1, benchmarks: [], referenceScore: null } })],
      ["close", leaderboard({ planetId: "close", faction: { numParticipants: 100, myRank: 50, myPoints: 1, benchmarks: [], referenceScore: null } })],
    ]);
    expect(sortDominationPlanets(planets, byPlanet, noStars).map((p) => p.planetId)).toEqual(["close", "far", "unranked"]);
  });

  it("sinks a planet that is both ranked and just-captured to the bottom, overriding rank", () => {
    const planets = [
      planet({
        planetId: "ranked-but-captured",
        sideOwner: "For",
        pointsFor: 10,
        pointsAgainst: 9999,
        struggleData: { conquestThresholdPointsAttacker: 9000, conquestThresholdPointsDefender: 10000 },
      }),
      planet({ planetId: "ranked-and-contested" }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>([
      ["ranked-but-captured", leaderboard({ planetId: "ranked-but-captured", faction: { numParticipants: 100, myRank: 1, myPoints: 1, benchmarks: [], referenceScore: null } })],
      ["ranked-and-contested", leaderboard({ planetId: "ranked-and-contested", faction: { numParticipants: 100, myRank: 5, myPoints: 1, benchmarks: [], referenceScore: null } })],
    ]);
    expect(sortDominationPlanets(planets, byPlanet, noStars).map((p) => p.planetId)).toEqual(["ranked-and-contested", "ranked-but-captured"]);
  });

  it("sorts unranked planets after ranked ones, ascending by points remaining for the closest side to capture", () => {
    const planets = [
      planet({ planetId: "ranked" }),
      planet({ planetId: "hard", sideOwner: "For", pointsFor: 100, pointsAgainst: 100, struggleData: { conquestThresholdPointsAttacker: 10000, conquestThresholdPointsDefender: 10000 } }),
      planet({ planetId: "easy", sideOwner: "For", pointsFor: 100, pointsAgainst: 9900, struggleData: { conquestThresholdPointsAttacker: 10000, conquestThresholdPointsDefender: 10000 } }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>([
      ["ranked", leaderboard({ planetId: "ranked", faction: { numParticipants: 100, myRank: 5, myPoints: 1, benchmarks: [], referenceScore: null } })],
    ]);
    expect(sortDominationPlanets(planets, byPlanet, noStars).map((p) => p.planetId)).toEqual(["ranked", "easy", "hard"]);
  });

  it("tie-breaks equal points-remaining (or both missing struggleData) by ascending faction participant count", () => {
    const planets = [planet({ planetId: "crowded" }), planet({ planetId: "sparse" })];
    const byPlanet = new Map<string, PlanetLeaderboard>([
      ["crowded", leaderboard({ planetId: "crowded", faction: { numParticipants: 500, myRank: null, myPoints: null, benchmarks: [], referenceScore: null } })],
      ["sparse", leaderboard({ planetId: "sparse", faction: { numParticipants: 20, myRank: null, myPoints: null, benchmarks: [], referenceScore: null } })],
    ]);
    expect(sortDominationPlanets(planets, byPlanet, noStars).map((p) => p.planetId)).toEqual(["sparse", "crowded"]);
  });

  it("handles planets with no leaderboard data at all (sorts them into the unranked group, last)", () => {
    const planets = [planet({ planetId: "no-data" }), planet({ planetId: "has-data" })];
    const byPlanet = new Map<string, PlanetLeaderboard>([
      ["has-data", leaderboard({ planetId: "has-data", faction: { numParticipants: 100, myRank: null, myPoints: null, benchmarks: [{ rank: 10, points: 500 }], referenceScore: null } })],
    ]);
    expect(sortDominationPlanets(planets, byPlanet, noStars).map((p) => p.planetId)).toEqual(["has-data", "no-data"]);
  });

  it("always sinks just-captured planets (negative points remaining) below live contested ones, regardless of sort mode", () => {
    const planets = [
      // Devastation already crossed its threshold - stale, should sink to the bottom.
      planet({
        planetId: "just-captured",
        sideOwner: "For",
        pointsFor: 10,
        pointsAgainst: 9999,
        struggleData: { conquestThresholdPointsAttacker: 9000, conquestThresholdPointsDefender: 10000 },
      }),
      planet({
        planetId: "still-contested",
        sideOwner: "For",
        pointsFor: 10,
        pointsAgainst: 100,
        struggleData: { conquestThresholdPointsAttacker: 9000, conquestThresholdPointsDefender: 10000 },
      }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>();
    for (const mode of ["closestToCapture", "imperialFirst", "devastationFirst"] as const) {
      expect(sortDominationPlanets(planets, byPlanet, noStars, mode).map((p) => p.planetId)).toEqual(["still-contested", "just-captured"]);
    }
  });

  it("imperialFirst mode sorts by imperial points remaining first, devastation as tiebreak", () => {
    const planets = [
      planet({
        planetId: "imperial-far",
        sideOwner: "Against",
        pointsFor: 10,
        pointsAgainst: 10,
        struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
      }),
      planet({
        planetId: "imperial-close",
        sideOwner: "Against",
        pointsFor: 900,
        pointsAgainst: 10,
        struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
      }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>();
    expect(sortDominationPlanets(planets, byPlanet, noStars, "imperialFirst").map((p) => p.planetId)).toEqual(["imperial-close", "imperial-far"]);
  });

  it("devastationFirst mode sorts by devastation points remaining first, imperial as tiebreak", () => {
    const planets = [
      planet({
        planetId: "devastation-far",
        sideOwner: "For",
        pointsFor: 10,
        pointsAgainst: 10,
        struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
      }),
      planet({
        planetId: "devastation-close",
        sideOwner: "For",
        pointsFor: 10,
        pointsAgainst: 900,
        struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
      }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>();
    expect(sortDominationPlanets(planets, byPlanet, noStars, "devastationFirst").map((p) => p.planetId)).toEqual(["devastation-close", "devastation-far"]);
  });

  it("puts starred planets ahead of ranked ones, ordered by sort mode within the starred group", () => {
    const planets = [
      planet({ planetId: "ranked-only" }),
      planet({
        planetId: "starred-far",
        sideOwner: "For",
        pointsFor: 100,
        pointsAgainst: 100,
        struggleData: { conquestThresholdPointsAttacker: 10000, conquestThresholdPointsDefender: 10000 },
      }),
      planet({
        planetId: "starred-close",
        sideOwner: "For",
        pointsFor: 100,
        pointsAgainst: 9900,
        struggleData: { conquestThresholdPointsAttacker: 10000, conquestThresholdPointsDefender: 10000 },
      }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>([
      ["ranked-only", leaderboard({ planetId: "ranked-only", faction: { numParticipants: 100, myRank: 1, myPoints: 1, benchmarks: [], referenceScore: null } })],
    ]);
    const starred = new Set(["starred-far", "starred-close"]);
    expect(sortDominationPlanets(planets, byPlanet, starred).map((p) => p.planetId)).toEqual(["starred-close", "starred-far", "ranked-only"]);
  });

  it("sinks a starred planet in cooldown (0 points both sides) to the bottom, overriding star", () => {
    const planets = [
      planet({
        planetId: "starred-cooldown",
        struggleData: { conquestThresholdPointsAttacker: 1000, conquestThresholdPointsDefender: 1000 },
      }),
      planet({ planetId: "starred-live" }),
    ];
    const byPlanet = new Map<string, PlanetLeaderboard>();
    const starred = new Set(["starred-cooldown", "starred-live"]);
    expect(sortDominationPlanets(planets, byPlanet, starred).map((p) => p.planetId)).toEqual(["starred-live", "starred-cooldown"]);
  });

  it("does not treat a planet with 0/0 points but no struggleData as cooldown (never fetched yet, not Domination-active)", () => {
    const planets = [planet({ planetId: "no-struggle-data" })];
    const byPlanet = new Map<string, PlanetLeaderboard>();
    expect(sortDominationPlanets(planets, byPlanet, noStars).map((p) => p.planetId)).toEqual(["no-struggle-data"]);
  });
});

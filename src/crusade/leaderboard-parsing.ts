// Pure, Tauri-free leaderboard-id-building and raw-response parsing, shared between the client's
// own live, per-account fetch (src/api/fetch-crusade-data.ts's fetchPlanetLeaderboard) and the
// Worker's shared, account-agnostic cache (worker/leaderboard-cache.ts). Living here lets the
// Worker import this directly instead of hand-duplicating it - see crusade-data-mapping.ts's own
// top-of-file comment for why fetch-crusade-data.ts itself can't be imported into the Workers
// runtime.
//
// readLeaderboard below DOES parse myRank/myPoints/localEntries off the raw response when the
// server sends them - that's correct and necessary for the client's live fetch, the only place
// those fields get used (to highlight the logged-in viewer's own position). The Worker's cache
// must never read those three fields off whatever this returns: the Worker's own request is made
// using one dedicated service account's credentials, so a populated myRank/myPoints here reflects
// THAT account's position, not whoever ends up viewing the cached data - showing it to a random
// visitor (or a different logged-in user) as "your rank" would be a real correctness bug, not just
// unwanted noise. worker/leaderboard-cache.ts's buildSharedSide enforces this by construction
// (only ever destructuring numParticipants/topEntries into its own narrower, myRank-less type) -
// keep it that way if this file ever changes.
import type { CrusadeFactionStanding, LeaderboardBenchmark } from "../api/types";

export function leaderboardIdsForPlanet(crusadeId: string, seasonNumber: number, planetId: string) {
  const base = `${crusadeId}_${seasonNumber}_${planetId}`;
  return {
    factionFor: `crusadeFaction:crusade_leaderboard_planet_side_factions_${base}_for`,
    factionAgainst: `crusadeFaction:crusade_leaderboard_planet_side_factions_${base}_against`,
    playerFor: `crusadePlayer:crusade_leaderboard_planet_side_players_${base}_for`,
    playerAgainst: `crusadePlayer:crusade_leaderboard_planet_side_players_${base}_against`,
  };
}

// The per-faction player leaderboard (all players playing as one specific faction, ranked against
// each other) - unlike the side leaderboard above, this isn't split _for/_against, one id per
// faction.
export function factionPlayerLeaderboardId(crusadeId: string, seasonNumber: number, planetId: string, factionId: string): string {
  return `crusadePlayer:crusade_leaderboard_planet_faction_players_${crusadeId}_${seasonNumber}_${planetId}_${factionId}`;
}

export interface LeaderboardRow {
  position: number;
  points: number;
  participantId?: string;
  factionId?: string;
}

function parseRows(rows: any): LeaderboardRow[] {
  return (rows ?? []).map((e: any) => ({ position: e.position, points: e.points, participantId: e.participantId, factionId: e.factionId }));
}

export interface RawLeaderboardEntry {
  numParticipants: number;
  myRank: number | null;
  myPoints: number | null;
  topEntries: LeaderboardRow[];
  // Entries surrounding the player's own rank - present when myRank doesn't place in the top 25
  // shown by topEntries.
  localEntries: LeaderboardRow[];
}

// A missing/wrong leaderboardId type prefix doesn't error - the server echoes the id back with
// no numParticipants/topEntries, indistinguishable at a glance from a genuinely empty
// leaderboard. Requiring numParticipants here is what actually distinguishes "no entry" (a typo)
// from "entry exists, player just isn't on it" (a real absence).
export function readLeaderboard(leaderboards: any, leaderboardId: string, myUserId: string): RawLeaderboardEntry | null {
  const entry = leaderboards?.[leaderboardId];
  if (!entry || typeof entry.numParticipants !== "number") return null;
  const topEntries = parseRows(entry.topEntries);
  const localEntries = parseRows(entry.localEntries);
  // Confirmed by the user: the server only sends myRank/myPoints at all when the player's own
  // rank falls outside topEntries - if they're already visible there (e.g. sitting at #1), those
  // fields are omitted entirely rather than sent as null, so the player has to be found by
  // matching their own participantId (== the userId the request was made with) within topEntries
  // (or localEntries, on the off chance it's populated without myRank) instead.
  const myRow = entry.myRank == null ? (topEntries.find((e) => e.participantId === myUserId) ?? localEntries.find((e) => e.participantId === myUserId)) : undefined;
  return {
    numParticipants: entry.numParticipants,
    // myRank comes back 0-based from the API (unlike topEntries[].position, which is also 0-based
    // but already handled correctly via `position === rank - 1` in buildBenchmarks) - +1 here so
    // the displayed rank matches the #1/#10/#25 benchmarks it's compared against. myRow's position
    // is already 0-based the same way, so it gets the same +1.
    myRank: entry.myRank != null ? entry.myRank + 1 : myRow ? myRow.position + 1 : null,
    myPoints: entry.myPoints ?? myRow?.points ?? null,
    topEntries,
    localEntries,
  };
}

export function topFactionStandings(entry: RawLeaderboardEntry | null): CrusadeFactionStanding[] {
  return (entry?.topEntries ?? []).filter((e) => e.factionId).map((e) => ({ factionId: e.factionId!, points: e.points }));
}

// The default collapsed view (LeaderboardBreakdownCell) - omitted individually (not filled in from
// other ranks) when that exact rank doesn't exist, e.g. #25 on a leaderboard under 25 participants.
const BENCHMARK_RANKS = [1, 5, 10, 25];

export function buildBenchmarks(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  return BENCHMARK_RANKS.filter((rank) => entry.topEntries.some((e) => e.position === rank - 1)).map((rank) => ({
    rank,
    points: entry.topEntries.find((e) => e.position === rank - 1)!.points,
  }));
}

// The expanded view's full top-25 list (as many of the real rows as exist), ascending by rank.
export function buildTopEntries(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  return [...entry.topEntries].sort((a, b) => a.position - b.position).map((e) => ({ rank: e.position + 1, points: e.points }));
}

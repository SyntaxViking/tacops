import { isTauri } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./invoke-with-timeout";
import { fetchWithTimeout } from "./fetch-with-timeout";
import planetData from "../assets/planet-data.json";
import type {
  Credentials,
  CrusadeData,
  CrusadeFactionStanding,
  Environment,
  FactionLeaderboardResult,
  LeaderboardBenchmark,
  PlanetLeaderboard,
  SideLeaderboardResult,
} from "./types";

const planetNameById = new Map((planetData as { planetId: string; name: string }[]).map((p) => [p.planetId, p.name]));
const planetZoneById = new Map((planetData as { planetId: string; zone: number }[]).map((p) => [p.planetId, p.zone]));

// Turns a raw GET_CRUSADE eventResponseData object into a CrusadeData - factored out so
// crusade-cache-seed.ts can reuse it against a cached/replayed response (from
// /api/crusade-cache, see worker/crusade-cache.ts) exactly as this module's own live fetch below
// does, with no second implementation.
export function mapCrusadeResponseData(data: any): CrusadeData {
  const { phase, activeZone } = findActivePhase(data?.downtimePhase, data?.crusadePhases ?? [], data?.strugglePhase);
  return {
    crusadeId: data?.crusadeId ?? "",
    seasonNumber: data?.seasonNumber ?? 0,
    chosenSide: data?.chosenSide ?? "",
    forFactionId: data?.forFactionId ?? "",
    againstFactionId: data?.againstFactionId ?? "",
    playerTargetPlanetId: data?.playerTargetPlanetId ?? null,
    guildTargetPlanetId: data?.guildTargetPlanetId ?? null,
    activeZone,
    phase,
    planets: (data?.planetsData ?? []).map((p: any) => ({
      planetId: p.planetId,
      name: planetNameById.get(p.planetId) ?? p.planetId,
      sideOwner: p.sideOwner,
      ownedByFaction: p.ownedByFaction,
      pointsFor: p.pointsFor,
      pointsAgainst: p.pointsAgainst,
      struggleData: p.struggleData,
      zone: planetZoneById.get(p.planetId) ?? null,
    })),
  };
}

// Both transports replay APP_START -> CONNECT -> GET_CRUSADE server-side, each individually
// bounded at 20s - same reasoning as fetchPlayerData's timeout.
export async function fetchCrusadeData(
  environment: Environment,
  webCredentials?: { userId: string; clientSecret: string },
): Promise<CrusadeData> {
  const response = isTauri()
    ? await (async () => {
        const credentials = await invokeWithTimeout<Credentials>("find_credentials", { environment }, 20_000);
        return invokeWithTimeout<any>("fetch_crusade_data", { environment, ...credentials }, 60_000);
      })()
    : await fetchWithTimeout<any>("/api/fetch-crusade-data", { environment, ...webCredentials, snowId: "" }, 60_000);

  return mapCrusadeResponseData(response?.eventResults?.[0]?.eventResponseData);
}

interface RawCrusadePhase {
  phase: string;
  zone?: string;
  startsOn: number;
  endsOn: number;
}

// The three phase-schedule pieces GET_CRUSADE returns: one downtimePhase, one crusadePhases entry
// per zone ("CRUSADE", zone1..zone6, 1-based - planet-data.json's zone field is 0-based, matching
// the underlying game data it was extracted from, hence the -1 below), and one strugglePhase (the
// Domination phase, no zone - contests every planet at once). Only one should ever bracket "now"
// (the schedule is contiguous, non-overlapping).
export function findActivePhase(
  downtimePhase: RawCrusadePhase | undefined,
  crusadePhases: RawCrusadePhase[],
  strugglePhase: RawCrusadePhase | undefined,
): { phase: "CRUSADE" | "STRUGGLE" | "DOWNTIME" | null; activeZone: number | null } {
  const now = Date.now();
  const allPhases = [downtimePhase, ...crusadePhases, strugglePhase].filter((p): p is RawCrusadePhase => p !== undefined);
  const active = allPhases.find((p) => now >= p.startsOn && now < p.endsOn);
  if (!active) return { phase: null, activeZone: null };

  if (active.phase !== "CRUSADE" || !active.zone) {
    return { phase: active.phase as "CRUSADE" | "STRUGGLE" | "DOWNTIME", activeZone: null };
  }
  const oneBased = parseInt(active.zone.replace("zone", ""), 10);
  return { phase: "CRUSADE", activeZone: Number.isNaN(oneBased) ? null : oneBased - 1 };
}

// Only planet-data.json's static zone assignment tells us which planets are contested *this*
// week - GET_CRUSADE's own planetsData carries cumulative totals from every past phase too, so
// "has points" is not a usable signal for "active this week" (see conversation notes).
export function activePlanetIds(activeZone: number | null): string[] {
  if (activeZone === null) return [];
  return (planetData as { planetId: string; zone: number }[]).filter((p) => p.zone === activeZone).map((p) => p.planetId);
}

// A player picks a side (chosenSide) but is independently pre-assigned one faction on EACH side
// (forFactionId/againstFactionId), so they always have something to play regardless of which side
// their guild ultimately commits to - "my faction" for this crusade season is simply whichever of
// the two matches chosenSide, available the moment GET_CRUSADE responds. No personal leaderboard
// rank is needed to determine it (unlike the old findOwnFactionId heuristic this replaced, which
// failed whenever the player had no rank on any currently-active planet).
export function resolveMyFactionId(crusadeData: Pick<CrusadeData, "chosenSide" | "forFactionId" | "againstFactionId">): string {
  return crusadeData.chosenSide.toLowerCase() === "for" ? crusadeData.forFactionId : crusadeData.againstFactionId;
}

// Exported so crusade-cache-seed.ts can build the same factionFor/factionAgainst ids to read back
// out of the cache's stored `leaderboards` blob (see worker/crusade-cache.ts) - the poller
// (worker/poller.ts) builds its own copy of just this half, since it can't import this
// Tauri-coupled module directly.
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
// faction. Exported so crusade-cache-seed.ts can build this for an arbitrary *picked* faction, not
// just fetchPlanetLeaderboard's own myFactionId.
export function factionPlayerLeaderboardId(crusadeId: string, seasonNumber: number, planetId: string, factionId: string): string {
  return `crusadePlayer:crusade_leaderboard_planet_faction_players_${crusadeId}_${seasonNumber}_${planetId}_${factionId}`;
}

interface LeaderboardRow {
  position: number;
  points: number;
  participantId?: string;
  factionId?: string;
}

interface RawLeaderboardEntry {
  numParticipants: number;
  myRank: number | null;
  myPoints: number | null;
  topEntries: LeaderboardRow[];
  // Entries surrounding the player's own rank - present when myRank doesn't place in the top 25
  // shown by topEntries.
  localEntries: LeaderboardRow[];
}

function parseRows(rows: any): LeaderboardRow[] {
  return (rows ?? []).map((e: any) => ({ position: e.position, points: e.points, participantId: e.participantId, factionId: e.factionId }));
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

// Exported for reuse by crusade-cache-seed.ts, which calls this against a leaderboard entry read
// back out of the cache (via readLeaderboard, also exported below) instead of a live fetch.
export function topFactionStandings(entry: RawLeaderboardEntry | null): CrusadeFactionStanding[] {
  return (entry?.topEntries ?? []).filter((e) => e.factionId).map((e) => ({ factionId: e.factionId!, points: e.points }));
}

// The default collapsed view (LeaderboardBreakdownCell) - omitted individually (not filled in from
// other ranks) when that exact rank doesn't exist, e.g. #25 on a leaderboard under 25 participants.
const BENCHMARK_RANKS = [1, 5, 10, 25];

// A player can "hop" planets and end up on a different side per-planet than their season-level
// chosenSide, so which of the two queried sides is "mine" can only be determined by which one
// actually has a myRank - there should only ever be at most one (confirmed by a real capture
// where only the _against side had myRank set while _for didn't, for the same planet).
function pickMine(forEntry: RawLeaderboardEntry | null, againstEntry: RawLeaderboardEntry | null): (RawLeaderboardEntry & { myRank: number }) | null {
  if (forEntry && forEntry.myRank !== null) return forEntry as RawLeaderboardEntry & { myRank: number };
  if (againstEntry && againstEntry.myRank !== null) return againstEntry as RawLeaderboardEntry & { myRank: number };
  return null;
}

function buildBenchmarks(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  return BENCHMARK_RANKS.filter((rank) => entry.topEntries.some((e) => e.position === rank - 1)).map((rank) => ({
    rank,
    points: entry.topEntries.find((e) => e.position === rank - 1)!.points,
  }));
}

// The expanded view's full top-25 list (as many of the real rows as exist), ascending by rank.
function buildTopEntries(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  return [...entry.topEntries].sort((a, b) => a.position - b.position).map((e) => ({ rank: e.position + 1, points: e.points }));
}

// The expanded view's "your rank +/-2" window - empty when there's no personal rank to center it
// on. localEntries only comes back populated when myRank doesn't land in topEntries (see
// readLeaderboard) and may cover a wider window than +/-2, so both sources get pooled and clipped
// to exactly that range; deduping by position covers the (normally impossible) case of the same
// row appearing in both.
function buildNearMe(entry: RawLeaderboardEntry): LeaderboardBenchmark[] {
  if (entry.myRank == null) return [];
  const byPosition = new Map<number, LeaderboardRow>();
  for (const row of [...entry.topEntries, ...entry.localEntries]) {
    const rank = row.position + 1;
    if (rank >= entry.myRank - 2 && rank <= entry.myRank + 2) byPosition.set(row.position, row);
  }
  return [...byPosition.values()]
    .map((row) => ({ rank: row.position + 1, points: row.points }))
    .sort((a, b) => a.rank - b.rank);
}

// chosenSide is only consulted as a fallback - when the player has no personal rank on either
// side (pickMine finds nothing), the breakpoints are still useful to judge whether it'd be worth
// moving here, so this falls back to showing whichever side matches the player's crusade-wide
// chosenSide (not both - per discussion, simpler to reason about one list than two).
export function mergeSideLeaderboard(
  forEntry: RawLeaderboardEntry | null,
  againstEntry: RawLeaderboardEntry | null,
  chosenSide: string,
): SideLeaderboardResult | null {
  const mine = pickMine(forEntry, againstEntry);
  if (mine) {
    return {
      numParticipants: mine.numParticipants,
      myRank: mine.myRank,
      myPoints: mine.myPoints,
      benchmarks: buildBenchmarks(mine),
      topEntries: buildTopEntries(mine),
      nearMe: buildNearMe(mine),
    };
  }
  const fallback = chosenSide.toLowerCase() === "for" ? forEntry : againstEntry;
  if (!fallback) return null;
  return {
    numParticipants: fallback.numParticipants,
    myRank: null,
    myPoints: null,
    benchmarks: buildBenchmarks(fallback),
    topEntries: buildTopEntries(fallback),
    nearMe: [],
  };
}

// Unlike the side (_players) leaderboard, the per-faction leaderboard
// (crusade_leaderboard_planet_faction_players_..._{factionId}) was never split by side to begin
// with - one leaderboard per named faction, no _for/_against variants - so there's nothing to
// merge here, just a direct read. Benchmarks show regardless of whether the player has a
// personal rank on this specific planet's faction leaderboard - these leaderboards have
// thousands of participants (same scale as the side leaderboard), so #1/#5/#10/#25 are just as
// useful for judging a planet the player hasn't touched yet as one they have.
export function buildFactionLeaderboard(entry: RawLeaderboardEntry | null): FactionLeaderboardResult | null {
  if (!entry) return null;
  return {
    numParticipants: entry.numParticipants,
    myRank: entry.myRank,
    myPoints: entry.myPoints,
    benchmarks: buildBenchmarks(entry),
    topEntries: buildTopEntries(entry),
    nearMe: buildNearMe(entry),
  };
}

async function fetchLeaderboards(
  environment: Environment,
  credentials: { userId: string; clientSecret: string; snowId: string },
  leaderboardIds: string[],
): Promise<any> {
  const response = isTauri()
    ? await invokeWithTimeout<any>("fetch_leaderboard_data", { environment, ...credentials, leaderboardIds }, 60_000)
    : await fetchWithTimeout<any>("/api/fetch-leaderboard-data", { environment, ...credentials, leaderboardIds }, 60_000);
  return response?.eventResult?.eventResponseData?.leaderboards;
}

// Single-planet replacement for the old all-planets-at-once fetchLeaderboardData - called
// repeatedly (initial load, rolling auto-refresh, manual refresh) by App.tsx's scheduler, one
// planet at a time, so each planet's card/row can update independently instead of the whole tab
// blocking until every planet finishes.
export async function fetchPlanetLeaderboard(
  environment: Environment,
  crusadeId: string,
  seasonNumber: number,
  chosenSide: string,
  planetId: string,
  myFactionId: string,
  webCredentials?: { userId: string; clientSecret: string },
): Promise<PlanetLeaderboard> {
  const credentials = isTauri()
    ? await invokeWithTimeout<Credentials>("find_credentials", { environment }, 20_000)
    : { userId: webCredentials?.userId ?? "", clientSecret: webCredentials?.clientSecret ?? "", snowId: "" };

  const ids = leaderboardIdsForPlanet(crusadeId, seasonNumber, planetId);
  const sideLeaderboards = await fetchLeaderboards(environment, credentials, [ids.factionFor, ids.factionAgainst, ids.playerFor, ids.playerAgainst]);

  const factionFor = readLeaderboard(sideLeaderboards, ids.factionFor, credentials.userId);
  const factionAgainst = readLeaderboard(sideLeaderboards, ids.factionAgainst, credentials.userId);
  const playerFor = readLeaderboard(sideLeaderboards, ids.playerFor, credentials.userId);
  const playerAgainst = readLeaderboard(sideLeaderboards, ids.playerAgainst, credentials.userId);

  // myFactionId comes from resolveMyFactionId (GET_CRUSADE's chosenSide/forFactionId/
  // againstFactionId) - always known up front, so this only skips as a defensive no-op if
  // GET_CRUSADE ever omits those fields (fetchCrusadeData defaults them to "").
  let faction: FactionLeaderboardResult | null = null;
  if (myFactionId) {
    const factionLeaderboardId = factionPlayerLeaderboardId(crusadeId, seasonNumber, planetId, myFactionId);
    const factionLeaderboards = await fetchLeaderboards(environment, credentials, [factionLeaderboardId]);
    faction = buildFactionLeaderboard(readLeaderboard(factionLeaderboards, factionLeaderboardId, credentials.userId));
  }

  return {
    planetId,
    topFactionsFor: topFactionStandings(factionFor),
    topFactionsAgainst: topFactionStandings(factionAgainst),
    side: mergeSideLeaderboard(playerFor, playerAgainst, chosenSide),
    faction,
    forParticipants: playerFor?.numParticipants ?? null,
    againstParticipants: playerAgainst?.numParticipants ?? null,
  };
}

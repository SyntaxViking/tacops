export type Environment = "prod" | "qa";

export interface Credentials {
  userId: string;
  clientSecret: string;
  snowId: string;
}

export interface BonusObjective {
  objectiveType: string;
  objectiveTarget?: string;
}

export interface ExpeditionBoardEntry {
  expeditionId: string;
  id: string;
  category: string;
  rarity: string;
  participants: number;
  duration: number;
  bonusObjectives: BonusObjective[];
  baseRewards: string[];
  bonusRewards: string[];
  status: string;
  startedOn?: number;
  units?: string[];
}

export type RawUnit = {
  id: string;
  rank?: number;
  progressionIndex?: number;
  xpLevel?: number;
  power?: number;
  // Damage profiles this specific player's equipped relics add on top of the character's own (see
  // equippedRelicDamageProfiles) - stamped at fetch time, like power.
  extraDamageProfiles?: string[];
} & Record<string, unknown>;

export interface CrusadePhase {
  phase: string; // "CRUSADE" | "DOWNTIME" | "STRUGGLE"
  zone?: string; // e.g. "zone3" - only present on CRUSADE phases
  startsOn: number;
  endsOn: number;
}

export interface CrusadeStruggleData {
  conquestThresholdPointsAttacker: number;
  conquestThresholdPointsDefender: number;
  // True for planets still inside the ~8h post-expansion lockout, before they become targetable
  // again in the Domination/STRUGGLE phase - recaptureTimestamp is when that lockout ends.
  isExpansionCooldown?: boolean;
  recaptureTimestamp?: number;
}

export interface CrusadePlanet {
  planetId: string;
  name: string;
  sideOwner?: string;
  ownedByFaction?: string;
  pointsFor?: number;
  pointsAgainst?: number;
  struggleData?: CrusadeStruggleData;
  // 0-based sector/zone this planet belongs to, from the static planet-data.json - null only if a
  // planet id somehow isn't in that file.
  zone: number | null;
}

// Map-layout data for one planet, as it appears in the sector map - separate from CrusadePlanet
// (ownership/points) because this comes from a different source (GET_PLAYER's embedded
// crusadeEvent live-event module, not the dedicated GET_CRUSADE call - see fetch-player-data.ts).
export interface CrusadeSectorPlanet {
  planetId: string;
  zone: number; // 0-based
  type: string; // "Fortress" | "Civilized" | "Dead" | "Hive" | "Feral" | "NotPlayable" ("Sun" excluded)
  positionX: number;
  positionY: number;
}

export interface CrusadeConnection {
  planet1: string;
  planet2: string;
}

export interface CrusadeSectorMap {
  planets: CrusadeSectorPlanet[];
  connections: CrusadeConnection[];
}

export interface CrusadeData {
  crusadeId: string;
  seasonNumber: number;
  chosenSide: string;
  forFactionId: string;
  againstFactionId: string;
  playerTargetPlanetId: string | null;
  guildTargetPlanetId: string | null;
  // 0-based, derived from crusadePhases - only meaningful when phase is "CRUSADE".
  activeZone: number | null;
  // Which of the schedule's phases currently brackets "now" - null if none does. "CRUSADE" means
  // the classic per-zone Expansion display (activeZone set); "STRUGGLE" is the all-map Domination
  // phase (activeZone irrelevant - every planet is contestable at once); "DOWNTIME" is the
  // pre-season gap.
  phase: "CRUSADE" | "STRUGGLE" | "DOWNTIME" | null;
  planets: CrusadePlanet[];
}

export interface CrusadeFactionStanding {
  factionId: string;
  points: number;
}

export interface LeaderboardBenchmark {
  rank: number; // 1, 5, 10, or 25
  points: number;
}

export interface SideLeaderboardResult {
  numParticipants: number;
  // null means the player has no rank on either side of this planet - benchmarks still show
  // (falling back to the player's crusade-wide chosenSide) so they can judge whether it'd be
  // worth moving here, just without a rank/percentile/"You" line.
  myRank: number | null;
  myPoints: number | null;
  benchmarks: LeaderboardBenchmark[];
  // Same top-10%/#25 figure as FactionLeaderboardResult, shown for context - planet sort order
  // is still driven by the Faction Leaderboard's referenceScore, not this one.
  referenceScore: LeaderboardBenchmark | null;
}

export interface FactionLeaderboardResult {
  numParticipants: number;
  // null means the player has no personal rank on this planet's faction leaderboard - benchmarks
  // still show (thousands of participants per faction, same scale as the side leaderboard) so
  // they're just as useful without a personal rank as with one.
  myRank: number | null;
  myPoints: number | null;
  benchmarks: LeaderboardBenchmark[];
  // The top-10% rank/score if it's within the visible top-25 window, else the #25 rank/score - a
  // representative "how competitive is this planet" figure used to sort the planet list (and
  // displayed alongside benchmarks when its rank isn't already one of them). Null only when
  // there's no leaderboard entry at all to compute it from.
  referenceScore: LeaderboardBenchmark | null;
}

export interface PlanetLeaderboard {
  planetId: string;
  // Both sides' faction breakdown - general competitive context, not "my" position, so both are
  // always kept (unlike side/faction below, which collapse to whichever side is actually mine).
  topFactionsFor: CrusadeFactionStanding[];
  topFactionsAgainst: CrusadeFactionStanding[];
  // A player can "hop" planets and end up on a different side per-planet than their season-level
  // chosenSide, so "which side is mine" can only be determined per-planet, from whichever _for/
  // _against query actually comes back with a myRank - null if neither does.
  side: SideLeaderboardResult | null;
  faction: FactionLeaderboardResult | null;
}

// Per-planet leaderboard fetch/refresh state, owned in App.tsx and threaded down through the
// Crusades tab's cards/tables - drives the fetched-at timestamp, the loading spinner overlay, and
// the manual refresh button's disabled state.
export interface PlanetRefreshEntry {
  leaderboard: PlanetLeaderboard | null;
  // Timestamps are tracked separately so the UI can show "stale but last known-good" alongside a
  // currently-failing attempt, rather than only ever showing one ambiguous timestamp.
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastAttemptFailed: boolean;
  isLoading: boolean;
}

export interface PlayerResources {
  stamina: number;
  staminaNextTokenAt: number | null;
  staminaCapAt: number | null;
  treasureBeach: number;
  treasureBeachNextTokenAt: number | null;
  treasureBeachCapAt: number | null;
  waves: number;
  wavesNextTokenAt: number | null;
  wavesCapAt: number | null;
  pvp: number;
  pvpPosition: number | null;
  pvpGroupSize: number | null;
  pvpNextTokenAt: number | null;
  pvpCapAt: number | null;
  pvpPausesAt: number | null;
  pvpStopped: boolean;
  guildBoss: number; // "raid tokens" - has special burn-at-cap logic, see guildBossBurnAt
  guildBossNextTokenAt: number | null;
  guildBossCapAt: number | null;
  guildBossBurnAt: number | null;
  guildBossBomb: number;
  guildBossBombNextTokenAt: number | null;
  guildBossBombCapAt: number | null;
  mowAmmo: number;
  heroQuest: number;
  heroQuestNextTokenAt: number | null;
  heroQuestCapAt: number | null;
  // False when no Linear Hero Event is currently live (module absent from liveEvents) - distinct
  // from the event running with stamina genuinely at 0.
  heroQuestActive: boolean;
  survival: number;
  survivalNextTokenAt: number | null;
  survivalCapAt: number | null;
  // False when no seasonal event is currently live - ResourceTokens omits the tile entirely in
  // this case (unlike heroQuestActive, which grays the tile out instead).
  survivalActive: boolean;
}

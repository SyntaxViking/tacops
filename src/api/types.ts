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

export interface PlanetDefenseCounts {
  imperial: number;
  devastation: number;
}

export type OnslaughtAlliance = "Imperial" | "Chaos" | "Xenos";

export interface OnslaughtTierBoard {
  // Matches the Rank enum's numeric values directly (1-21) - confirmed against a real capture,
  // including the collapsed "X3 challenge" entries (tier 3/6/9/12 = Stone3/Iron3/Bronze3/Silver3).
  tier: number;
  boardId: string;
  // True once this rank's "1"/"2" sub-tiers have collapsed away and only the repeatable "3"
  // challenge battle remains (see onslaught-extraction.ts) - drives which rank icon variant
  // (plain numeral vs. the "4"/challenge skull) the UI shows for this entry.
  isChallenge: boolean;
}

export type OnslaughtBoards = Record<OnslaughtAlliance, OnslaughtTierBoard[]>;

// Everything optional here mirrors what the guild war snapshot itself omits for a unit that's
// never been touched by combat (e.g. remainingHp) - see guild-war-extraction.ts.
export interface GuildWarCharacterSlot {
  unitId: string;
  rank?: number;
  progressionIndex?: number;
  xpLevel?: number;
  activeAbilityLevel?: number;
  passiveAbilityLevel?: number;
  // Damage profiles from this unit's equipped relic ability, if any - the closest "equipment"
  // signal the guild war snapshot carries. There's no item/instance data here (unlike the
  // Characters tab's own `items`), just the relic's already-resolved ability id, so this is
  // resolved straight from that (see guild-war-extraction.ts's relicAbilityDamageProfiles).
  extraDamageProfiles: string[];
  defeated: boolean;
}

export interface GuildWarMachineOfWar {
  unitId: string;
  progressionIndex?: number;
  xpLevel?: number;
  activeAbilityLevel?: number;
  passiveAbilityLevel?: number;
  defeated: boolean;
}

// One player's lineup within a site - the game's own cap is 5 characters, but this passes
// through whatever the API actually sent rather than padding/truncating.
export interface GuildWarLineup {
  characters: GuildWarCharacterSlot[];
  // Null only if the game sent no machine of war for this lineup at all (not the same as it
  // being defeated).
  machineOfWar: GuildWarMachineOfWar | null;
  // Whole-lineup clear flag (defeatedByUserId on the API side) - every character's own
  // `defeated` already folds this in, so this is only for lineup-level UI (e.g. graying out a
  // lineup's machine of war, which carries no defeat signal of its own).
  defeated: boolean;
}

export interface GuildWarPlayer {
  userId: string | null;
  // Resolved from the owning guild's own guildWarGuildData.members (userId -> displayName) -
  // null if that lookup fails (e.g. a member who's since left the guild) or there's no userId at
  // all to look up.
  displayName: string | null;
  lineups: GuildWarLineup[];
}

export interface GuildWarSite {
  zoneId: string;
  // The game's own zone type id (e.g. "Trenches1", "HQ", "ArtilleryPosition1"). Null means this
  // site hasn't been revealed to us yet - the GET_PLAYER response itself omits everything but
  // zoneId for a site we can't see (see guild-war-extraction.ts), so there's no type to show.
  zoneType: string | null;
  // One rarity cap per lineup slot (5 entries, index-aligned with each player's `lineups`),
  // looked up from the current battlefield level's zone-tier config. Null when zoneType is
  // unknown (hidden site) - there's nothing to look up.
  rarityCaps: string[] | null;
  // The board art id for this site's zone type (config.zoneTypeConfigs[zoneType].boardId), for
  // the detail view's thumbnail. Null when zoneType is unknown (hidden site).
  boardId: string | null;
  // config.zoneTypeConfigs[zoneType].spawnPointsSet - which of that board's spawn-point layouts
  // this site uses, for placing a selected lineup's characters on the board thumbnail. Defaults
  // to 0 when the zone type's config omits the field (same absent-means-0 convention already
  // confirmed for RawPvpEncounter.spawnPointsSet below). Null only when zoneType itself is
  // unknown (hidden site) - there's no config entry to default from at all.
  spawnPointsSet: number | null;
  // The two players occupying this site, each with their own identity and 5 lineups - null when
  // the site hasn't been revealed yet (hidden sites carry no lineup data at all).
  players: [GuildWarPlayer, GuildWarPlayer] | null;
}

// Always 5 rows x 3 columns, matching the in-game grid exactly. Row 0 is the front line (the row
// closest to the player in the game's own window); row 4 is the far/back row.
export type GuildWarBattlefield = GuildWarSite[][];

export interface GuildWarData {
  // The battlefield the player's guild is attacking (the other guild's board). Null when no
  // guild war is currently active for this player.
  attack: GuildWarBattlefield | null;
  // The battlefield the player's guild is defending (their own board, always fully revealed).
  defense: GuildWarBattlefield | null;
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
  rank: number;
  points: number;
}

export interface SideLeaderboardResult {
  numParticipants: number;
  // null means the player has no rank on either side of this planet - benchmarks still show
  // (falling back to the player's crusade-wide chosenSide) so they can judge whether it'd be
  // worth moving here, just without a rank/percentile/"You" line.
  myRank: number | null;
  myPoints: number | null;
  // The default collapsed view: #1/#5/#10/#25, omitted individually if that rank doesn't exist
  // (e.g. #25 on a leaderboard with under 25 participants) - no filling in from other ranks.
  benchmarks: LeaderboardBenchmark[];
  // The expanded view (LeaderboardBreakdownCell's disclosure triangle): every row actually
  // returned - topEntries is the real top 25 (as many as exist), nearMe is the player's own
  // rank +/-2 (empty when myRank is null, or fully covered by topEntries already).
  topEntries: LeaderboardBenchmark[];
  nearMe: LeaderboardBenchmark[];
}

export interface FactionLeaderboardResult {
  numParticipants: number;
  // null means the player has no personal rank on this planet's faction leaderboard - benchmarks
  // still show (thousands of participants per faction, same scale as the side leaderboard) so
  // they're just as useful without a personal rank as with one.
  myRank: number | null;
  myPoints: number | null;
  benchmarks: LeaderboardBenchmark[];
  topEntries: LeaderboardBenchmark[];
  nearMe: LeaderboardBenchmark[];
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
  // Both sides' raw side-leaderboard participant counts, kept independently unlike `side` above
  // (which collapses to whichever side is mine) - not personal data, just an aggregate headcount,
  // so unlike myRank/myPoints it's safe to show on the anonymous view too. Lets a global "ranked
  // Imperial vs Devastation participants" count be summed across every planet's leaderboard. null
  // when that side's leaderboard didn't come back at all for this planet.
  forParticipants: number | null;
  againstParticipants: number | null;
}

// The shared, account-agnostic subset of a planet's leaderboard data cached in D1 by
// worker/poller.ts (worker/leaderboard-cache.ts) and served by GET /api/leaderboard-cache - never
// myRank/myPoints/nearMe, which only make sense for whichever account fetched them. Drives both
// the ~1-minute client freshness-poll (src/App.tsx) and the logged-out home page's side/faction
// leaderboards - see crusade-cache-seed.ts's toSeededPlanetLeaderboard for how this maps into the
// per-account PlanetLeaderboard shape every existing Crusades-tab component already renders.
export interface SharedSideLeaderboard {
  numParticipants: number;
  benchmarks: LeaderboardBenchmark[];
  topEntries: LeaderboardBenchmark[];
}

export interface SharedPlanetLeaderboard {
  topFactionsFor: CrusadeFactionStanding[];
  topFactionsAgainst: CrusadeFactionStanding[];
  sideFor: SharedSideLeaderboard | null;
  sideAgainst: SharedSideLeaderboard | null;
  // One specific faction's players ranked against each other, keyed by factionId - covers every
  // faction (src/factions/faction-side.ts's FACTION_SIDE), not just whichever one a given viewer
  // belongs to, so the logged-out home page's FactionPicker can show any of them and a logged-in
  // user's own faction can be looked up immediately at first paint. Missing key means that
  // faction's leaderboard wasn't cached for this planet (not the same as a stored null).
  perFaction: Record<string, SharedSideLeaderboard>;
  fetchedAt: number;
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

// GET_PVP_STATE's per-encounter opponent preview - see pvp/pvp-view-model.ts for how this gets
// turned into display data. Field names here match the raw wire shape (camelCase as sent), not
// this repo's usual naming - keep it that way so a diff against a fresh capture stays obvious.
export interface RawPvpItemInstance {
  itemId: string;
  level: number;
}

export interface RawPvpUnit {
  progressionIndex?: number;
  xpLevel?: number;
  // Absent on Machine of War units - they have no rank.
  rank?: number;
  active?: number;
  passive?: number;
  upgrades?: number[];
  // Absent on Machine of War units - they have no equipment slots.
  items?: Record<string, string>; // SlotN -> itemInstanceId
  starLevel?: number;
}

export interface RawPvpOpponent {
  userId: string;
  displayName: string;
  avatar: string;
  avatarFrameId?: string;
  rating: number;
  level: number;
  position: number;
  units: {
    units: Record<string, RawPvpUnit>;
    lineup: { pvp: string[] };
    mowLineup: { pvp: string };
  };
  items: {
    items: Record<string, RawPvpItemInstance>;
  };
}

export interface RawPvpEncounter {
  opponent: RawPvpOpponent;
  ratingGain: number;
  ratingLoss: number;
  boardId: string;
  // Absent (not 0) when it IS 0 - confirmed via a real capture (keys were exactly
  // ["boardId","opponent","ratingGain","ratingLoss"], no spawnPointsSet at all) - same
  // omit-the-default convention as PlayerResources' regen fields in fetch-player-data.ts.
  spawnPointsSet?: number;
}

export interface RawPvpState {
  playerPosition: number | null;
  pvpEncounters: RawPvpEncounter[];
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
  pvpBurnAt: number | null;
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
  legendaryEvent: number;
  legendaryEventNextTokenAt: number | null;
  legendaryEventCapAt: number | null;
  // False when no Legendary Event is currently live - ResourceTokens omits the tile entirely in
  // this case, same as survivalActive.
  legendaryEventActive: boolean;
}

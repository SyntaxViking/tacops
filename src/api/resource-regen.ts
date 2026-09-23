// Regen constants: stamina (level table) and waves come from datamine gameconfig.1.41.json;
// treasureBeach/guildBoss/guildBossBomb aren't exposed in any gameconfig file (checked
// globalValues, powerLevelsConfig, resourceCaps, battles/items/consumables configs) and are
// confirmed directly from the user's own game knowledge instead. This app's live
// GAME_CONFIG_VERSION doesn't match any available datamine snapshot's fullConfigHash, so treat all
// of these as best-effort estimates, not authoritative.
// PVP additionally uses the server's own pvpState.staminaRegenUntil as a regen-STOP deadline (not
// a "next token" value - see computePvpTimings below), since regen doesn't tick at a flat rate
// indefinitely the way the other resources do.

// clientGameConfig.player.powerLevelsConfig[*].maxStamina - index = hero.player.powerLevel
// (0-based, verified: powerLevel 68 -> maxStamina 154 on a real account).
const STAMINA_MAX_BY_POWER_LEVEL = [
  60, 60, 60, 60, 65, 70, 75, 80, 85, 90, 92, 94, 96, 98, 100, 101, 102, 103, 104, 105, 106, 107,
  108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126,
  127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145,
  146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164,
  165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183,
  184, 185,
];
const STAMINA_REGEN_MS = 300_000; // 5 min/point

const WAVES_MAX = 3;
const WAVES_REGEN_MS = 57_600_000; // 16 h/point

const TREASURE_BEACH_MAX = 2;
const TREASURE_BEACH_REGEN_MS = 43_200_000; // 12 h/point

const GUILD_BOSS_MAX = 3; // "raid tokens" - see computeGuildBossTimings for their burn-at-cap quirk
const GUILD_BOSS_REGEN_MS = 43_200_000; // 12 h/point

const GUILD_BOSS_BOMB_MAX = 1;
const GUILD_BOSS_BOMB_REGEN_MS = 64_800_000; // 18 h/point

export const PVP_MAX = 15; // exported so ResourceTokens.tsx can label the "no more regen" state
const PVP_REGEN_MS = 9_600_000; // 2h40m/point (normal ticking rate; see computePvpTimings for the pause)

// Not in any datamine config (same situation as treasureBeach/guildBoss above) - confirmed
// directly from the user's own game knowledge.
const HERO_QUEST_MAX = 6;
const HERO_QUEST_REGEN_MS = 7_200_000; // 2h/point

export interface StaminaShaped {
  // Omitted entirely (not sent as 0) by the API when a resource is actually at 0 - same convention
  // already documented in fetch-player-data.ts for the flat currentAmount reads.
  currentAmount?: number;
  lastUpdatedThreshold: number;
}

export interface RegenTimings {
  nextTokenAt: number | null; // epoch ms; null if already at cap or data missing
  capAt: number | null;
}

function computeTimings(stamina: StaminaShaped | undefined, max: number, regenMsPerPoint: number): RegenTimings {
  if (!stamina) return { nextTokenAt: null, capAt: null };
  const currentAmount = stamina.currentAmount ?? 0;
  if (currentAmount >= max) return { nextTokenAt: null, capAt: null };
  const missing = max - currentAmount;
  return {
    nextTokenAt: stamina.lastUpdatedThreshold + regenMsPerPoint,
    capAt: stamina.lastUpdatedThreshold + regenMsPerPoint * missing,
  };
}

export function computeStaminaTimings(stamina: StaminaShaped | undefined, powerLevel: number | undefined): RegenTimings {
  const index = Math.min(Math.max(powerLevel ?? 0, 0), STAMINA_MAX_BY_POWER_LEVEL.length - 1);
  return computeTimings(stamina, STAMINA_MAX_BY_POWER_LEVEL[index], STAMINA_REGEN_MS);
}

// Unlike the other resources here, Survival's max/regen rate is sent live in the event payload
// itself (staminaEventModule.staminaConfig) rather than needing to be reverse-engineered, so it's
// read dynamically each fetch instead of hardcoded - and is undefined entirely when no seasonal
// event is currently running.
export function computeSurvivalTimings(
  stamina: StaminaShaped | undefined,
  maxStamina: number | undefined,
  regenMsPerPoint: number | undefined,
): RegenTimings {
  if (maxStamina === undefined || regenMsPerPoint === undefined) return { nextTokenAt: null, capAt: null };
  return computeTimings(stamina, maxStamina, regenMsPerPoint);
}

export function computeWavesTimings(stamina: StaminaShaped | undefined): RegenTimings {
  return computeTimings(stamina, WAVES_MAX, WAVES_REGEN_MS);
}
export function computeTreasureBeachTimings(stamina: StaminaShaped | undefined): RegenTimings {
  return computeTimings(stamina, TREASURE_BEACH_MAX, TREASURE_BEACH_REGEN_MS);
}
export function computeHeroQuestTimings(stamina: StaminaShaped | undefined): RegenTimings {
  return computeTimings(stamina, HERO_QUEST_MAX, HERO_QUEST_REGEN_MS);
}
export function computeGuildBossBombTimings(stamina: StaminaShaped | undefined): RegenTimings {
  return computeTimings(stamina, GUILD_BOSS_BOMB_MAX, GUILD_BOSS_BOMB_REGEN_MS);
}

// Twice a day, at 09:45 and 22:45 UTC, the server BURNS (discards) a raid token instead of letting
// it sit at cap - confirmed by the user. Finds the earliest such checkpoint at or after `t`.
const BURN_CHECKPOINT_UTC_MINUTES = [9 * 60 + 45, 22 * 60 + 45];

function nextBurnCheckpointAtOrAfter(t: number): number {
  const d = new Date(t);
  const dayStartUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const candidates = [
    dayStartUtc + BURN_CHECKPOINT_UTC_MINUTES[0] * 60_000,
    dayStartUtc + BURN_CHECKPOINT_UTC_MINUTES[1] * 60_000,
    dayStartUtc + 24 * 3_600_000 + BURN_CHECKPOINT_UTC_MINUTES[0] * 60_000,
  ];
  return candidates.find((c) => c >= t) ?? candidates[candidates.length - 1];
}

export interface GuildBossTimings extends RegenTimings {
  // Next 09:45/22:45 UTC checkpoint at which a token is lost if still sitting at cap then - it's
  // common to intentionally cap while waiting for a raid target, so this isn't a "you did something
  // wrong" warning, just the deadline before that idle capped token gets burned.
  burnAt: number | null;
}

export function computeGuildBossTimings(stamina: StaminaShaped | undefined, now: number = Date.now()): GuildBossTimings {
  const { nextTokenAt, capAt } = computeTimings(stamina, GUILD_BOSS_MAX, GUILD_BOSS_REGEN_MS);
  if (!stamina) return { nextTokenAt, capAt, burnAt: null };
  const currentAmount = stamina.currentAmount ?? 0;
  // Reference point to search the burn schedule from: already sitting at cap right now, or the
  // future moment they'd reach it (capAt is only null here if already capped, since `stamina` is
  // known to exist - fall back to `now` defensively either way).
  const capReferencePoint = currentAmount >= GUILD_BOSS_MAX ? now : (capAt ?? now);
  return { nextTokenAt, capAt, burnAt: nextBurnCheckpointAtOrAfter(capReferencePoint) };
}

export interface PvpTimings {
  nextTokenAt: number | null; // null if already at cap, no data, or regen has stopped (see `stopped`)
  capAt: number | null; // set only if the cap will be reached before regen pauses
  pausesAt: number | null; // set only if regen WON'T reach the cap before pausing (shown instead of capAt)
  stopped: boolean; // true if already past staminaRegenUntil and still under cap - no schedule to show
}

// staminaRegenUntil marks when regen STOPS for the season (confirmed by the user - not a "next
// token" timestamp), later reset by the server to 10 at some unpredictable point not modeled here.
// Normal lastUpdatedThreshold + interval math still gives the real next/cap tick times; the
// deadline only matters if it would cut that projection short.
export function computePvpTimings(
  stamina: StaminaShaped | undefined,
  staminaRegenUntil: number | null,
  now: number = Date.now(),
): PvpTimings {
  const none: PvpTimings = { nextTokenAt: null, capAt: null, pausesAt: null, stopped: false };
  if (!stamina) return none;
  const currentAmount = stamina.currentAmount ?? 0;
  if (currentAmount >= PVP_MAX) return none;

  if (staminaRegenUntil !== null && now >= staminaRegenUntil) {
    return { nextTokenAt: null, capAt: null, pausesAt: null, stopped: true };
  }

  const missing = PVP_MAX - currentAmount;
  const nextTokenAt = stamina.lastUpdatedThreshold + PVP_REGEN_MS;
  const capAt = stamina.lastUpdatedThreshold + PVP_REGEN_MS * missing;

  if (staminaRegenUntil === null || capAt <= staminaRegenUntil) {
    return { nextTokenAt, capAt, pausesAt: null, stopped: false }; // caps before the stop - deadline is irrelevant
  }

  // Won't reach the cap before regen pauses - "cap" would show a time that never actually
  // happens, so show the pause boundary instead.
  return {
    nextTokenAt: nextTokenAt <= staminaRegenUntil ? nextTokenAt : null,
    capAt: null,
    pausesAt: staminaRegenUntil,
    stopped: false,
  };
}

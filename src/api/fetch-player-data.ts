import { isTauri } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "./invoke-with-timeout";
import { fetchWithTimeout } from "./fetch-with-timeout";
import characterData from "../assets/character-data.json";
import mowData from "../assets/mow-data.json";
import { calculateBundledUnitPowers } from "../characters/character-power";
import { equippedRelicDamageProfiles } from "../characters/character-profile";
import { computeHeroQuestJars, type HeroQuestJar } from "../hero-quests/hero-quest-view-model";
import {
  computeGuildBossBombTimings,
  computeGuildBossTimings,
  computeHeroQuestTimings,
  computePvpTimings,
  computeStaminaTimings,
  computeSurvivalTimings,
  computeTreasureBeachTimings,
  computeWavesTimings,
} from "./resource-regen";
import type { Credentials, CrusadeSectorMap, Environment, ExpeditionBoardEntry, PlayerResources, RawUnit } from "./types";

const characterIds = new Set((characterData as { id: string }[]).map((c) => c.id));
const mowIds = new Set((mowData as { mows: { snowprintId: string }[] }).mows.map((m) => m.snowprintId));

export function isCharacterId(id: string): boolean {
  return characterIds.has(id);
}

export interface PlayerData {
  board: ExpeditionBoardEntry[];
  heroes: RawUnit[];
  machinesOfWar: RawUnit[];
  adViewsRemaining: number;
  resources: PlayerResources;
  heroQuestJars: HeroQuestJar[];
  sectorMap: CrusadeSectorMap;
  // The untouched GET_PLAYER envelope, kept around only so it can be exported as-is.
  raw: unknown;
}

// webCredentials is only read on the web build - the desktop build auto-discovers credentials
// from the local Tacticus install instead (find_credentials), same as always.
export async function fetchPlayerData(
  environment: Environment,
  webCredentials?: { userId: string; clientSecret: string },
): Promise<PlayerData> {
  // Both transports replay 3 sequential requests server-side (APP_START -> CONNECT -> GET_PLAYER),
  // each individually bounded at 20s - so the outer timeout here needs enough room for all three
  // in the worst realistic case, not just one.
  const response = isTauri()
    ? await (async () => {
        const credentials = await invokeWithTimeout<Credentials>("find_credentials", { environment }, 20_000);
        return invokeWithTimeout<any>("fetch_player_data", { environment, ...credentials }, 60_000);
      })()
    : await fetchWithTimeout<any>(
        "/api/fetch-player-data",
        { environment, ...webCredentials, snowId: "" },
        60_000,
      );

  // The API omits the board entirely (rather than sending an empty array) when a player has no
  // expeditions queued and none in progress - e.g. right after claiming everything, before the
  // board refreshes with new offers. That's a legitimate state, not a fetch failure.
  const board: ExpeditionBoardEntry[] =
    response?.eventResult?.eventResponseData?.player?.hero?.progress?.expeditions?.board ?? [];

  const hero = response?.eventResult?.eventResponseData?.player?.hero;
  const units: RawUnit[] = Object.entries(hero?.units?.units ?? {}).map(([id, data]) => ({
    id,
    ...(data as object),
  }));

  // Independent of the power calculation below (never throws) so neither can drop the other.
  for (const unit of units) {
    unit.extraDamageProfiles = equippedRelicDamageProfiles(unit.items, hero?.items?.items);
  }

  // All-or-nothing: a single missing/stale unit definition (e.g. a unit added since the bundled
  // GameConfig extraction) throws for the whole batch rather than returning some units with power
  // and others without, so a mixed-confidence power state never reaches the solver. Covers both
  // characters and Machines of War; the loop below stamps power onto whichever it matches.
  try {
    const powers = calculateBundledUnitPowers(response);
    const powerByUnitId = new Map(powers.map((p) => [p.unitId, p.power]));
    for (const unit of units) {
      const power = powerByUnitId.get(unit.id);
      if (power !== undefined) unit.power = power;
    }
  } catch (error) {
    console.error("Failed to calculate character power - leaving power unset for this fetch", error);
  }

  const powerLevel = hero?.player?.powerLevel;
  const staminaTimings = computeStaminaTimings(hero?.stamina, powerLevel);
  const wavesTimings = computeWavesTimings(hero?.progress?.waves?.stamina);
  const treasureBeachTimings = computeTreasureBeachTimings(hero?.progress?.treasureBeach?.stamina);
  const guildBossTimings = computeGuildBossTimings(hero?.progress?.guildState?.guildBoss?.attempts);
  const guildBossBombTimings = computeGuildBossBombTimings(hero?.progress?.guildState?.guildBoss?.bombAttempts);
  const pvpTimings = computePvpTimings(
    hero?.progress?.pvpState?.stamina,
    hero?.progress?.pvpState?.staminaRegenUntil ?? null,
  );
  // The LHE's liveEventConfigId (e.g. "linear_hero_event_2") increments per event iteration, so
  // it's matched by module type instead of a hardcoded id. Absent entirely when no LHE is live.
  const lheModule = hero?.liveEvents?.liveEvents
    ?.find((e: any) => e?.modules?.some((m: any) => m.type === "linearHeroEvent"))
    ?.modules?.find((m: any) => m.type === "linearHeroEvent")?.module;
  const heroQuestTimings = computeHeroQuestTimings(lheModule?.stamina);
  // The seasonal event's liveEventConfigId (e.g. "season_september_2026_event") rolls over monthly
  // like the LHE's does, so it's matched by module type instead. Its stamina/config live in a
  // separate staminaEventModule sibling of the "survival" module within the same live event.
  const survivalStaminaModule = hero?.liveEvents?.liveEvents
    ?.find((e: any) => e?.modules?.some((m: any) => m.type === "survival"))
    ?.modules?.find((m: any) => m.type === "staminaEventModule")?.module;
  const survivalTimings = computeSurvivalTimings(
    survivalStaminaModule?.stamina,
    survivalStaminaModule?.staminaConfig?.maxStamina,
    survivalStaminaModule?.staminaConfig?.staminaRegenerationTime !== undefined
      ? survivalStaminaModule.staminaConfig.staminaRegenerationTime * 1000
      : undefined,
  );

  // "currentAmount" is omitted entirely (rather than sent as 0) when a regenerating resource is
  // actually at 0, so every one of these needs a fallback rather than trusting the field's presence.
  const resources: PlayerResources = {
    stamina: hero?.stamina?.currentAmount ?? 0,
    staminaNextTokenAt: staminaTimings.nextTokenAt,
    staminaCapAt: staminaTimings.capAt,
    treasureBeach: hero?.progress?.treasureBeach?.stamina?.currentAmount ?? 0,
    treasureBeachNextTokenAt: treasureBeachTimings.nextTokenAt,
    treasureBeachCapAt: treasureBeachTimings.capAt,
    waves: hero?.progress?.waves?.stamina?.currentAmount ?? 0,
    wavesNextTokenAt: wavesTimings.nextTokenAt,
    wavesCapAt: wavesTimings.capAt,
    pvp: hero?.progress?.pvpState?.stamina?.currentAmount ?? 0,
    // Absent between seasons - null (not 0) so the UI can tell "not currently ranked" apart from
    // an actual position/size of 0.
    pvpPosition: hero?.progress?.pvpState?.playerPosition ?? null,
    pvpGroupSize: hero?.progress?.pvpState?.actualGroupSize ?? null,
    pvpNextTokenAt: pvpTimings.nextTokenAt,
    pvpCapAt: pvpTimings.capAt,
    pvpPausesAt: pvpTimings.pausesAt,
    pvpStopped: pvpTimings.stopped,
    guildBoss: hero?.progress?.guildState?.guildBoss?.attempts?.currentAmount ?? 0,
    guildBossNextTokenAt: guildBossTimings.nextTokenAt,
    guildBossCapAt: guildBossTimings.capAt,
    guildBossBurnAt: guildBossTimings.burnAt,
    guildBossBomb: hero?.progress?.guildState?.guildBoss?.bombAttempts?.currentAmount ?? 0,
    guildBossBombNextTokenAt: guildBossBombTimings.nextTokenAt,
    guildBossBombCapAt: guildBossBombTimings.capAt,
    mowAmmo: hero?.resources?.groupedCurrencies?.global?.machinesOfWarAmmo ?? 0,
    heroQuest: lheModule?.stamina?.currentAmount ?? 0,
    heroQuestNextTokenAt: heroQuestTimings.nextTokenAt,
    heroQuestCapAt: heroQuestTimings.capAt,
    heroQuestActive: lheModule !== undefined,
    survival: survivalStaminaModule?.stamina?.currentAmount ?? 0,
    survivalNextTokenAt: survivalTimings.nextTokenAt,
    survivalCapAt: survivalTimings.capAt,
    survivalActive: survivalStaminaModule !== undefined,
  };

  // The map layout (positions/adjacency) isn't in the dedicated GET_CRUSADE call
  // (fetch-crusade-data.ts) - confirmed via a real capture it's simply absent there. It only shows
  // up here, in GET_PLAYER's own embedded copy of the crusade live event.
  const crusadeEventModule = hero?.liveEvents?.liveEvents
    ?.find((e: any) => e?.modules?.some((m: any) => m.type === "crusadeEvent"))
    ?.modules?.find((m: any) => m.type === "crusadeEvent")?.module;
  const sectorMap: CrusadeSectorMap = {
    planets: (crusadeEventModule?.planetsConfig?.planets ?? [])
      .filter((p: any) => p.type !== "Sun")
      .map((p: any) => ({
        planetId: p.planetId,
        zone: parseInt(p.zone.replace("zone", ""), 10) - 1,
        type: p.type,
        positionX: p.positionX ?? 0,
        positionY: p.positionY ?? 0,
      })),
    connections: (crusadeEventModule?.planetsConfig?.connections ?? []).map((c: any) => ({
      planet1: c.planet1,
      planet2: c.planet2,
    })),
  };

  return {
    board,
    heroes: units.filter((u) => characterIds.has(u.id)),
    machinesOfWar: units.filter((u) => mowIds.has(u.id)),
    // Absent (not 0) means the game hasn't reported ad-view usage yet - e.g. no ads watched today
    // - in which case the daily allotment (7) hasn't been drawn down at all.
    adViewsRemaining: hero?.player?.adViews?.currentAmount ?? 7,
    resources,
    heroQuestJars: computeHeroQuestJars(hero?.loot?.urnOfBalls),
    sectorMap,
    raw: response,
  };
}

// Pure, Tauri-free parsing of a raw GET_CRUSADE response - shared between the client
// (src/api/fetch-crusade-data.ts, for its own live fetch) and the Worker (worker/poller.ts, for
// its checkpointed polling loop). Living here (rather than in fetch-crusade-data.ts) lets the
// Worker import it directly instead of hand-duplicating it: fetch-crusade-data.ts also exports
// network-calling wrappers (fetchCrusadeData/fetchPlanetLeaderboard) that import
// @tauri-apps/api/core and browser-only fetch helpers at module scope, which don't belong in the
// Workers runtime - importing fetch-crusade-data.ts at all (even for just one named export) would
// pull that whole module graph in. This module has no such dependency.
import { getPlanetData } from "../assets/seasons";
import type { CrusadeData } from "../api/types";

function planetNameById(): Map<string, string> {
  return new Map((getPlanetData() as { planetId: string; name: string }[]).map((p) => [p.planetId, p.name]));
}
function planetZoneById(): Map<string, number> {
  return new Map((getPlanetData() as { planetId: string; zone: number }[]).map((p) => [p.planetId, p.zone]));
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

// Turns a raw GET_CRUSADE eventResponseData object into a CrusadeData - the one place this mapping
// happens, reused against both a live response (fetchCrusadeData) and a cached/replayed one
// (crusade-cache-seed.ts's seedPlanetRefreshStateFromCache, worker/poller.ts's own crusade-snapshot
// write) with no second implementation.
export function mapCrusadeResponseData(data: any): CrusadeData {
  const { phase, activeZone } = findActivePhase(data?.downtimePhase, data?.crusadePhases ?? [], data?.strugglePhase);
  const nameById = planetNameById();
  const zoneById = planetZoneById();
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
      name: nameById.get(p.planetId) ?? p.planetId,
      sideOwner: p.sideOwner,
      ownedByFaction: p.ownedByFaction,
      pointsFor: p.pointsFor,
      pointsAgainst: p.pointsAgainst,
      struggleData: p.struggleData,
      zone: zoneById.get(p.planetId) ?? null,
    })),
  };
}

// Only planet-data.json's static zone assignment tells us which planets are contested *this*
// week - GET_CRUSADE's own planetsData carries cumulative totals from every past phase too, so
// "has points" is not a usable signal for "active this week".
export function activePlanetIds(activeZone: number | null): string[] {
  if (activeZone === null) return [];
  return (getPlanetData() as { planetId: string; zone: number }[]).filter((p) => p.zone === activeZone).map((p) => p.planetId);
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

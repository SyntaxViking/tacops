import { isTauri } from "@tauri-apps/api/core";
import { invokeWithTimeout } from "../api/invoke-with-timeout";
import { BOARD_ASSET_ORIGIN } from "./board-image";

export interface SpawnPoint {
  index: number;
  x: number;
  y: number;
  column: number;
  row: number;
  spawnPointType: number;
  tag: string;
  direction: number;
  room: number;
}

export interface SpawnPointGroup {
  teamWithPlayerIndex: number;
  // A raw slot/position id, NOT a pixel coordinate (unlike `spawnPoints`, datamine_tacticus
  // couldn't derive an (x, y) for this) - so the Machine of War's own spot on the map can't be
  // placed from this manifest. Not needed anyway: the user's request was specifically for
  // character portraits on the map, not the MoW.
  machineOfWarPosition: number;
  spawnPoints: SpawnPoint[];
}

export interface BoardSpawnPointSet {
  spawnPointsSetIndex: number;
  groups: SpawnPointGroup[];
}

export type SpawnPointManifest = Record<string, BoardSpawnPointSet[]>;

export interface CharacterSpawnPosition {
  characterId: string;
  x: number;
  y: number;
}

let cachedManifest: Promise<SpawnPointManifest> | null = null;

// spawn-points.json lives alongside the board images (see board-image.ts's BOARD_ASSET_ORIGIN
// comment) - fetched once per session and cached, same reasoning as the images: too large (1.9MB)
// to bundle into every build for a feature most sessions won't open.
//
// Tauri dispatches through a Rust command (fetch_spawn_points) instead of fetching directly here,
// unlike a plain web fetch - a raw browser fetch() of this cross-origin URL from inside the
// desktop app's webview hits a CORS failure Cloudflare's static asset server can't be made to
// satisfy (its OPTIONS preflight response is an unconditional 405). The web build has no such
// problem (same-origin - the site IS tacops.cpunerd.workers.dev), so it fetches directly.
export function fetchSpawnPointManifest(): Promise<SpawnPointManifest> {
  if (!cachedManifest) {
    cachedManifest = isTauri() ? fetchTauriManifest() : fetchWebManifest();
  }
  return cachedManifest;
}

function fetchWebManifest(): Promise<SpawnPointManifest> {
  return fetch(`${BOARD_ASSET_ORIGIN}/spawn-points.json`).then((res) => {
    if (!res.ok) {
      throw new Error(`failed to fetch spawn-points.json: HTTP ${res.status}`);
    }
    return res.json();
  });
}

// Tauri-only: merges board-assets/spawn-points.json straight off disk (read_local_spawn_points)
// on top of the live Worker's copy, local winning per board id. Unlike read_local_board_image's
// fallback (which only kicks in once the remote image outright fails to load), the remote
// manifest fetch here always succeeds - it's just potentially stale/incomplete, since newly
// extracted boards land in the local file well before they're deployed to the Worker (confirmed:
// the live manifest was missing 13 of 15 guild war boards present locally). A failed local read
// (e.g. malformed JSON, or no local extraction at all) falls back to the remote copy alone rather
// than failing the whole fetch.
async function fetchTauriManifest(): Promise<SpawnPointManifest> {
  const remote = invokeWithTimeout<SpawnPointManifest>("fetch_spawn_points", undefined, 30_000);
  const local = invokeWithTimeout<SpawnPointManifest | null>("read_local_spawn_points", undefined, 10_000).catch((error) => {
    console.error("[board-layout] read_local_spawn_points failed - using the remote manifest alone", error);
    return null;
  });
  const [remoteManifest, localManifest] = await Promise.all([remote, local]);
  return localManifest ? { ...remoteManifest, ...localManifest } : remoteManifest;
}

// Opponent's side is TeamWithPlayerIndex === 1 - confirmed by datamine_tacticus's own
// addHexesToMap, which colors this same team's spawn points as the "enemy spawn" (gold) highlight,
// distinct from TeamWithPlayerIndex === 0's "deploy" (cyan) highlight.
const OPPONENT_TEAM_INDEX = 1;

// lineup[i] <-> this group's spawnPoints[i] (sorted by `index`) is a working hypothesis, not yet
// confirmed against a real live capture + rendered board. A board's spawn point group can have
// more entries than the 5 fielded characters (boards are shared across other game modes with
// different unit counts) - this pairs from the start and places at most as many characters as
// there are points, rather than assuming an exact count match.
export function resolveSpawnPositionsForTeam(
  manifest: SpawnPointManifest,
  boardId: string,
  spawnPointsSet: number,
  teamWithPlayerIndex: number,
  lineup: readonly string[],
): CharacterSpawnPosition[] {
  const set = manifest[boardId]?.find((s) => s.spawnPointsSetIndex === spawnPointsSet);
  const group = set?.groups.find((g) => g.teamWithPlayerIndex === teamWithPlayerIndex);
  if (!group) return [];

  const points = [...group.spawnPoints].sort((a, b) => a.index - b.index);
  const count = Math.min(points.length, lineup.length);
  return Array.from({ length: count }, (_, i) => ({
    characterId: lineup[i],
    x: points[i].x,
    y: points[i].y,
  }));
}

export function resolveCharacterSpawnPositions(
  manifest: SpawnPointManifest,
  boardId: string,
  spawnPointsSet: number,
  lineup: readonly string[],
): CharacterSpawnPosition[] {
  return resolveSpawnPositionsForTeam(manifest, boardId, spawnPointsSet, OPPONENT_TEAM_INDEX, lineup);
}

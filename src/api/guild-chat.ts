import { invokeWithTimeout } from "./invoke-with-timeout";
import type { Credentials, Environment } from "./types";

export type ChannelName = "guild" | "guildchat";

export interface EventUser {
  userId?: string;
  displayName?: string;
  avatar?: string;
  avatarFrameId?: string;
}

/**
 * One realtime channel event as it arrives from the backend: the wire fields plus the `channel`
 * the backend tagged it with. Known event types narrow this shape further (see guild-events.ts).
 */
export interface RawChannelEvent {
  type: string;
  seq: number;
  channel: ChannelName;
  timestamp?: number;
  sourceUser?: EventUser;
  content?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface GuildFeedInit {
  guildId: string;
  guildName: string | null;
  guildTag: string | null;
  /** Newest event id per channel — where a scrollback read starts. Null if the channel is empty. */
  seqs: { guild: number | null; guildchat: number | null };
}

export async function findCredentials(
  environment: Environment,
): Promise<Credentials> {
  return invokeWithTimeout<Credentials>("find_credentials", { environment });
}

export async function guildFeedInit(
  environment: Environment,
  credentials: Credentials,
  guildId?: string,
): Promise<GuildFeedInit> {
  return invokeWithTimeout<GuildFeedInit>("guild_feed_init", {
    environment,
    ...credentials,
    guildId: guildId ?? null,
  });
}

/** Raidman's metadata for an uploaded replay (the fields this app surfaces). */
export interface ReplayUploadResult {
  success: boolean;
  hash: string;
  alreadyUploaded?: boolean;
  totalDamage?: number;
  bossUnitId?: string;
  message?: string;
}

/** The public viewer link for an uploaded replay. */
export function raidmanReplayUrl(hash: string): string {
  return `https://tacticus-raidman.com/public/replays/${hash}`;
}

/** Fetches the shared replay from the game and re-uploads it to Raidman (unlisted). */
export async function uploadReplay(
  environment: Environment,
  credentials: Credentials,
  guildId: string,
  replayId: string,
): Promise<ReplayUploadResult> {
  return invokeWithTimeout<ReplayUploadResult>("upload_replay", {
    environment,
    ...credentials,
    guildId,
    replayId,
  });
}

export async function readChannelWindow(
  environment: Environment,
  credentials: Credentials,
  guildId: string,
  channel: ChannelName,
  seq: number,
): Promise<RawChannelEvent[]> {
  return invokeWithTimeout<RawChannelEvent[]>("read_channel_window", {
    environment,
    ...credentials,
    guildId,
    channel,
    seq,
  });
}

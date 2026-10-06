// Which season's planet layout (src/assets/seasons/<season>/planet-data.json + sector-map.json) is
// live at a given moment - named after the game client patch version each season started in (e.g.
// "1.41"), since that's how a new season's planets are actually identified/datamined, not
// Tacticus's own numeric seasonNumber field (GET_CRUSADE returns it, but it's just an incrementing
// counter with no bearing on which static planet layout is correct right now).
//
// See README's "Crusade seasons" section for the full setup, including how to prepare a new
// season and how/when to set a season's endsAt below - this file only has the schedule itself and
// the pure logic that resolves it, kept short and dependency-free so it's trivial to read and test
// on its own.
export type Season = "1.41" | "1.43";

export const SEASONS: readonly Season[] = ["1.41", "1.43"];

export interface SeasonScheduleEntry {
  season: Season;
  // Epoch ms this season's window ends (exclusive) - resolveActiveSeason moves on to the next
  // entry at exactly this instant. null means "no end set yet" - this season stays active
  // indefinitely (the common case for whichever season is newest, until the one after it is being
  // prepared and this value becomes known).
  endsAt: number | null;
}

// Ordered oldest to newest. Exactly one entry should have endsAt: null at any given time - the
// currently-ongoing season, whose actual end isn't known yet. Every earlier entry must have a real
// endsAt (resolveActiveSeason stops at the first one that's null or still in the future, so a null
// entry followed by more entries would make those later ones unreachable).
export const SEASON_SCHEDULE: readonly SeasonScheduleEntry[] = [
  // Season 1.41 ends 2026-10-19T00:00:00Z - season 1.43 takes over automatically at that instant.
  { season: "1.41", endsAt: new Date("2026-10-19T00:00:00Z").getTime() },
  { season: "1.43", endsAt: null },
];

// Pure resolution logic, independently testable against any schedule/timestamp - not just
// SEASON_SCHEDULE/Date.now() (see activeSeason below, the convenience wrapper real callers use).
// The first entry that's either still open-ended (endsAt: null) or hasn't ended yet (nowMs is
// before its endsAt) is the active one. Falls back to the last entry if every entry has a real,
// already-passed endsAt (shouldn't happen per this file's own invariant above, but better to keep
// using the newest known season than to throw).
export function resolveActiveSeason(schedule: readonly SeasonScheduleEntry[], nowMs: number): Season {
  for (const entry of schedule) {
    if (entry.endsAt === null || nowMs < entry.endsAt) return entry.season;
  }
  return schedule[schedule.length - 1].season;
}

// What every reader (src/assets/seasons/index.ts) actually calls - resolved fresh against the
// current time on every call, never cached, so a schedule boundary passing takes effect the very
// next call with no deploy needed (see README for the caveat on already-open pages/long-lived
// processes).
export function activeSeason(nowMs: number = Date.now()): Season {
  return resolveActiveSeason(SEASON_SCHEDULE, nowMs);
}

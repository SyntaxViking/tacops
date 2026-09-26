import { groupObjectives, type BoardAssignmentResult } from "./board-solver";
import { characterSatisfiesObjective } from "./objective-eligibility";
import { entryIsUnavailable } from "./board-view-model";
import { getCharacterProfile } from "../characters/character-profile";
import { isCharacterId } from "../api/fetch-player-data";
import type { ExpeditionBoardEntry, RawUnit } from "../api/types";

// Dispatched/completed boards never went through the solver (solveBoardAssignment filters them
// out via entryIsUnavailable before building the LP), so there's no BoardSolution to look up for
// them - fulfillment has to be recomputed directly from the units that actually got sent, the
// same per-group counting the solver itself uses for bonusCompleted. `heroes` supplies each sent
// unit's relic-added damage profiles (entry.units is only ids), matching what the solver used.
function dispatchedUnitsFulfillObjectives(entry: ExpeditionBoardEntry, heroes: RawUnit[]): boolean {
  const groups = groupObjectives(entry.bonusObjectives);
  if (groups.length === 0) return true;

  const heroById = new Map(heroes.map((hero) => [hero.id, hero]));
  const profiles = (entry.units ?? [])
    .filter(isCharacterId)
    .map((id) => getCharacterProfile(id, heroById.get(id)?.extraDamageProfiles));
  return groups.every(
    (group) => profiles.filter((profile) => characterSatisfiesObjective(profile, group.objective)).length >= group.count,
  );
}

// "unrunnable" only applies to boards that haven't been dispatched yet - a dispatched/completed
// board is by definition already running, so it can only ever be "partial" or "complete".
export type EntryFulfillment = "unrunnable" | "partial" | "complete";

export function getEntryFulfillment(entry: ExpeditionBoardEntry, assignment: BoardAssignmentResult, heroes: RawUnit[]): EntryFulfillment {
  if (entryIsUnavailable(entry)) {
    return dispatchedUnitsFulfillObjectives(entry, heroes) ? "complete" : "partial";
  }
  const solution = assignment.get(entry.expeditionId);
  if (!solution?.run) return "unrunnable";
  return solution.bonusCompleted ? "complete" : "partial";
}

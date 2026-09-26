import solver, { type Model as LpModel, type SolveResult } from "javascript-lp-solver";
import { BoardFilter, type RankedUnit } from "./board-filter";
import { characterSatisfiesObjective } from "./objective-eligibility";
import { rewardAmount, type PriorityKey } from "./reward-amount";
import { estimateXpGain, isXpCapped } from "./xp-gain";
import { requiredAlliance } from "./board-alliance";
import { entryRarity, entryIsUnavailable } from "./board-view-model";
import { intToRank } from "../rank/rank.mapper";
import type { Rarity } from "../rarity/rarity.enum";
import { ProgressionIndexMapper } from "../progression/progression-index";
import { getCharacterProfile, type CharacterProfile } from "../characters/character-profile";
import { isCharacterId } from "../api/fetch-player-data";
import type { BonusObjective, ExpeditionBoardEntry, RawUnit } from "../api/types";

export interface RosterCharacter extends RankedUnit {
  id: string;
  xpLevel: number;
  power: number | null;
  profile: CharacterProfile;
  isFavorited: boolean;
  isAntiFavorited: boolean;
}

export interface BoardSolution {
  expeditionId: string;
  run: boolean;
  bonusCompleted: boolean;
  requiredCharacterIds: string[];
  optionalCharacterIds: string[];
}

export type BoardAssignmentResult = Map<string, BoardSolution>;

function committedCharacterIds(board: ExpeditionBoardEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of board) {
    if (!entryIsUnavailable(entry)) continue;
    for (const unitId of entry.units ?? []) {
      if (isCharacterId(unitId)) {
        ids.add(unitId);
      }
    }
  }
  return ids;
}

function buildRoster(
  heroes: RawUnit[],
  excludedIds: Set<string>,
  favoritedCharacterIds: ReadonlySet<string>,
  antiFavoritedCharacterIds: ReadonlySet<string>,
): RosterCharacter[] {
  return heroes
    .filter((hero) => !excludedIds.has(hero.id))
    .map((hero) => ({
      id: hero.id,
      rank: intToRank(hero.rank),
      rarity: ProgressionIndexMapper.toRarity(hero.progressionIndex),
      xpLevel: hero.xpLevel ?? 0,
      power: hero.power ?? null,
      profile: getCharacterProfile(hero.id, hero.extraDamageProfiles),
      isFavorited: favoritedCharacterIds.has(hero.id),
      isAntiFavorited: antiFavoritedCharacterIds.has(hero.id),
    }));
}

function isEligibleForBoard(unit: RosterCharacter, boardRarity: Rarity, allianceRequirement: string | undefined): boolean {
  return (
    BoardFilter.byRank([unit], boardRarity).length > 0 &&
    BoardFilter.byRarity([unit], boardRarity).length > 0 &&
    (allianceRequirement === undefined || unit.profile.alliance === allianceRequirement)
  );
}

export interface ObjectiveGroup {
  key: string;
  objective: BonusObjective;
  count: number;
}

export function groupObjectives(objectives: BonusObjective[]): ObjectiveGroup[] {
  const groups = new Map<string, ObjectiveGroup>();
  for (const objective of objectives) {
    const key = `${objective.objectiveType}::${objective.objectiveTarget ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { key, objective, count: 1 });
    }
  }
  return [...groups.values()];
}

type PriorityPassKey = `priority${number}`;
type PassKey = PriorityPassKey | "xpGain" | "runCount" | "favoriteScore" | "powerUsed";

const PRIORITY_TIER_COUNT = 4;

function priorityPassKey(tierIndex: number): PriorityPassKey {
  return `priority${tierIndex}`;
}

// The first N passes are the user's priority tiers (lexicographic - each pass's achieved value
// gets locked in via an `equal` constraint before the next pass runs, see runPasses), followed by
// the fixed xpGain/runCount/favoriteScore/powerUsed tail that always applies regardless of
// priority order. Each of these only ever decides WHICH specific characters fill an
// already-decided set of run/bonus outcomes - by the time favoriteScore runs, run count and total
// xp gain are already locked in, so maximizing "how many favorited characters got used" can never
// cost a bonus, a board run, or roster growth (see effectiveXpGain - anti-favorited units already
// can't compete for xp-growth slots either, same as an xp-capped unit). powerUsed runs last, after
// favoriteScore is also locked in, purely as a final tiebreaker among assignments that are equally
// good on every other axis: prefer using the highest-power characters.
const PASS_ORDER: Array<{ key: PassKey; opType: "max" | "min" }> = [
  ...Array.from({ length: PRIORITY_TIER_COUNT }, (_, i) => ({ key: priorityPassKey(i), opType: "max" as const })),
  { key: "xpGain", opType: "max" },
  { key: "runCount", opType: "max" },
  { key: "favoriteScore", opType: "max" },
  { key: "powerUsed", opType: "max" },
];

interface AssignRef {
  varName: string;
  characterId: string;
  boardId: string;
}

interface BuiltModel {
  model: LpModel;
  assignRefs: AssignRef[];
  runVarByBoard: Map<string, string>;
  bonusVarByBoard: Map<string, string>;
  groupsByBoard: Map<string, ObjectiveGroup[]>;
  eligibleCharactersByBoardGroup: Map<string, Map<string, string[]>>;
  participantsByBoard: Map<string, number>;
}

function buildModel(
  openBoards: ExpeditionBoardEntry[],
  roster: RosterCharacter[],
  priorityOrder: [PriorityKey, PriorityKey, PriorityKey, PriorityKey],
): BuiltModel {
  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {};
  const binaries: Record<string, 1> = {};

  const addCoef = (varName: string, constraintName: string, coef: number) => {
    const v = (variables[varName] ??= {});
    v[constraintName] = (v[constraintName] ?? 0) + coef;
  };

  const assignRefs: AssignRef[] = [];
  const runVarByBoard = new Map<string, string>();
  const bonusVarByBoard = new Map<string, string>();
  const groupsByBoard = new Map<string, ObjectiveGroup[]>();
  const eligibleCharactersByBoardGroup = new Map<string, Map<string, string[]>>();
  const participantsByBoard = new Map<string, number>();
  const usedCharacterIds = new Set<string>();

  for (const entry of openBoards) {
    const boardId = entry.expeditionId;
    const rarity = entryRarity(entry);
    const allianceRequirement = requiredAlliance(entry.category);
    const runVar = `run::${boardId}`;
    const yVar = `y::${boardId}`;
    runVarByBoard.set(boardId, runVar);
    bonusVarByBoard.set(boardId, yVar);
    participantsByBoard.set(boardId, entry.participants);
    binaries[runVar] = 1;
    binaries[yVar] = 1;

    constraints[`yrun::${boardId}`] = { max: 0 };
    addCoef(yVar, `yrun::${boardId}`, 1);
    addCoef(runVar, `yrun::${boardId}`, -1);

    priorityOrder.forEach((key, tierIndex) => {
      const passKey = priorityPassKey(tierIndex);
      if (key === "rarity") {
        // Rarity isn't tied to bonus-objective completion like the resource rewards below - it's
        // a property of running the board at all, so it weights runVar instead of yVar.
        addCoef(runVar, passKey, rarity);
      } else {
        addCoef(yVar, passKey, rewardAmount(entry.bonusRewards, key));
      }
    });
    addCoef(runVar, "runCount", 1);

    const slotConstraint = `slots::${boardId}`;
    constraints[slotConstraint] = { equal: 0 };
    addCoef(runVar, slotConstraint, -entry.participants);

    const eligibleRoster = roster.filter((unit) => isEligibleForBoard(unit, rarity, allianceRequirement));

    for (const unit of eligibleRoster) {
      const assignVar = `assign::${unit.id}::${boardId}`;
      binaries[assignVar] = 1;
      addCoef(assignVar, slotConstraint, 1);
      addCoef(assignVar, `excl::${unit.id}`, 1);
      addCoef(assignVar, "powerUsed", unit.power ?? 0);
      addCoef(assignVar, "xpGain", effectiveXpGain(unit));
      addCoef(assignVar, "favoriteScore", unit.isFavorited ? 1 : 0);
      assignRefs.push({ varName: assignVar, characterId: unit.id, boardId });
      usedCharacterIds.add(unit.id);
    }

    const groups = groupObjectives(entry.bonusObjectives);
    groupsByBoard.set(boardId, groups);
    const groupMap = new Map<string, string[]>();
    eligibleCharactersByBoardGroup.set(boardId, groupMap);

    for (const group of groups) {
      const groupConstraint = `group::${boardId}::${group.key}`;
      constraints[groupConstraint] = { min: 0 };
      addCoef(yVar, groupConstraint, -group.count);

      const eligibleIds: string[] = [];
      for (const unit of eligibleRoster) {
        if (characterSatisfiesObjective(unit.profile, group.objective)) {
          addCoef(`assign::${unit.id}::${boardId}`, groupConstraint, 1);
          eligibleIds.push(unit.id);
        }
      }
      groupMap.set(group.key, eligibleIds);
    }
  }

  for (const characterId of usedCharacterIds) {
    constraints[`excl::${characterId}`] = { max: 1 };
  }

  const model: LpModel = {
    // Overwritten before the first Solve() call in runPasses - these are just placeholders to
    // satisfy LpModel's shape.
    optimize: priorityPassKey(0),
    opType: "max",
    constraints,
    variables,
    binaries,
  };

  return { model, assignRefs, runVarByBoard, bonusVarByBoard, groupsByBoard, eligibleCharactersByBoardGroup, participantsByBoard };
}

// Safety net, not a tuned value - solver.Solve() runs synchronously (this library has no
// async/worker mode of its own; we run the whole module inside a Web Worker instead so this
// can't freeze the UI thread). Bounding each pass means the worst case is "slow and logged," not
// "hangs forever."
const SOLVE_TIMEOUT_MS = 10_000;

// A timed-out branch-and-bound search can return variable values that aren't cleanly 0/1 even
// though result.feasible says true - trusting that blindly (rounding each variable independently
// in extractSolution) can produce a rounded set that violates a hard constraint, like more
// characters assigned than a board has slots, even though the model itself is correct.
function isIntegralResult(model: LpModel, result: SolveResult): boolean {
  const epsilon = 1e-6;
  for (const varName of Object.keys(model.binaries ?? {})) {
    const value = Number(result[varName] ?? 0);
    if (Math.abs(value - Math.round(value)) > epsilon) return false;
  }
  return true;
}

type PassesResult = { result: SolveResult; status: "ok" | "degraded" } | { result: null; status: "failed" };

// If a later pass can't finish in time, falling back to the last pass that DID complete is still
// a fully valid, feasible assignment - just not optimized for the lower-priority tiers beyond
// that point. If even the first pass can't produce a usable result, there's nothing to fall back
// to - report that as a normal "failed" outcome rather than throwing, so the caller can fall back
// to the greedy solver instead of an exception. Whether the caller needs to warn the user at all
// depends on whether the resulting assignment actually leaves a board unrun - see
// solveBoardAssignment - not on which of these internal paths produced it.
function runPasses(model: LpModel): PassesResult {
  model.timeout = SOLVE_TIMEOUT_MS;
  let lastGoodResult: SolveResult | undefined;
  for (let i = 0; i < PASS_ORDER.length; i++) {
    const pass = PASS_ORDER[i];
    model.optimize = pass.key;
    model.opType = pass.opType;
    const startedAt = performance.now();
    const result = solver.Solve(model) as SolveResult;
    const elapsedMs = Math.round(performance.now() - startedAt);
    const hitTimeout = elapsedMs >= SOLVE_TIMEOUT_MS;
    const usable = result.feasible && isIntegralResult(model, result);
    console.log(
      `[board-solver] pass "${pass.key}" (${i + 1}/${PASS_ORDER.length}): feasible=${result.feasible} integral=${usable || !result.feasible} result=${result.result} took ${elapsedMs}ms${hitTimeout ? " (HIT TIMEOUT)" : ""}`,
    );
    if (!usable) {
      if (lastGoodResult) {
        console.warn(`[board-solver] pass "${pass.key}" didn't produce a usable result - falling back to the last completed pass's solution`);
        return { result: lastGoodResult, status: "degraded" };
      }
      console.warn(`[board-solver] pass "${pass.key}" didn't produce a usable result and there's no earlier fallback`);
      return { result: null, status: "failed" };
    }
    lastGoodResult = result;
    if (i < PASS_ORDER.length - 1) {
      model.constraints[pass.key] = { equal: Math.round(Number(result.result)) };
    }
  }
  return { result: lastGoodResult!, status: "ok" };
}

export interface GroupRequirement {
  key: string;
  count: number;
  eligibleAssignedIds: string[]; // assigned characters eligible for this group
}

// Exhaustively checks every subset of assignedIds (a board's participant count, always small - at
// most 2^5 = 32 subsets) against every group's count at once, returning the smallest one that
// still satisfies all of them. This replaces a per-group-independent "take the first N eligible"
// pass that could pick a character for one group without noticing another already-required
// character already satisfies it for free - unlike a greedy per-character pass, an exhaustive
// check like this is guaranteed to find the true minimum, not an order-dependent approximation.
export function findMinimalRequiredSubset(assignedIds: string[], groupRequirements: GroupRequirement[]): Set<string> {
  const n = assignedIds.length;
  let best: Set<string> | null = null;

  for (let mask = 0; mask < 1 << n; mask++) {
    const subset = new Set<string>();
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.add(assignedIds[i]);
    }

    const satisfiesAll = groupRequirements.every(
      (group) => group.eligibleAssignedIds.filter((id) => subset.has(id)).length >= group.count,
    );
    if (satisfiesAll && (best === null || subset.size < best.size)) {
      best = subset;
    }
  }

  return best ?? new Set(assignedIds);
}

// An anti-favorited unit is deliberately treated exactly like an XP-capped one for growth/fill
// purposes: deploying either wastes a growth opportunity (capped, no XP left to gain) or works
// against the player's own stated intent (anti-favorited) when an equally-usable alternative
// exists, so both get zeroed out of the xpGain-maximizing pass (see effectiveXpGain) and sink to
// the bottom of fillComparator's preference order - only ever used when no other eligible unit can
// fill the slot.
function isDeprioritizedForGrowth(unit: RosterCharacter): boolean {
  return isXpCapped(unit.rarity, unit.xpLevel) || unit.isAntiFavorited;
}

function effectiveXpGain(unit: RosterCharacter): number {
  return isDeprioritizedForGrowth(unit) ? 0 : estimateXpGain(unit.rarity, unit.xpLevel);
}

// Shared "who to prefer when there's no objective-coverage signal to go on" ordering: units
// deprioritized for growth (capped or anti-favorited, see isDeprioritizedForGrowth) sink to the
// bottom, then favorited units are preferred, then by power descending (falling back to
// last-place, not 0, when power is unknown - an uncomputed power shouldn't look weaker than a
// genuinely low-power character). Negative return means `a` is preferred over `b`, matching
// Array.prototype.sort's contract.
function fillComparator(a: RosterCharacter, b: RosterCharacter): number {
  const aAvoid = isDeprioritizedForGrowth(a) ? 1 : 0;
  const bAvoid = isDeprioritizedForGrowth(b) ? 1 : 0;
  if (aAvoid !== bAvoid) return aAvoid - bAvoid;
  const aFav = a.isFavorited ? 1 : 0;
  const bFav = b.isFavorited ? 1 : 0;
  if (aFav !== bFav) return bFav - aFav;
  return (b.power ?? -Infinity) - (a.power ?? -Infinity);
}

// Display order for a board's required/optional character lists (and the cross-board required
// pool) - always power descending, independent of whatever order the solver happened to assign or
// select them in. Unknown power (computation failed this fetch) sorts last, same convention as
// fillComparator.
function sortIdsByPower(ids: Iterable<string>, powerById: Map<string, number | null>): string[] {
  return [...ids].sort((a, b) => (powerById.get(b) ?? -Infinity) - (powerById.get(a) ?? -Infinity));
}

function buildPowerById(roster: RosterCharacter[]): Map<string, number | null> {
  return new Map(roster.map((unit) => [unit.id, unit.power]));
}

// Fallback for when runPasses() can't produce any usable LP result at all (see
// solveBoardAssignment) - processes boards mythic-first so scarce characters go to the
// highest-value boards, greedily assigns whichever available unit covers the most still-uncovered
// objective groups (a unit can cover several DIFFERENT groups in one pick, same as the LP's own
// group constraints, but never more than one slot of any single duplicated group), and falls back
// to a plain rank-based fill (deprioritizing XP-capped units) for boards it can't fully solve that
// way. Deterministic and fast (no LP), but not guaranteed optimal - callers must surface that
// clearly rather than presenting it as an equivalent result.
export function solveGreedyFallback(openBoards: ExpeditionBoardEntry[], roster: RosterCharacter[]): BoardAssignmentResult {
  const available = new Set(roster.map((unit) => unit.id));
  const powerById = buildPowerById(roster);
  const sortedBoards = [...openBoards].sort((a, b) => entryRarity(b) - entryRarity(a));
  const solutions: BoardAssignmentResult = new Map();
  const unableBoards: ExpeditionBoardEntry[] = [];

  function eligibleAvailableRoster(entry: ExpeditionBoardEntry): RosterCharacter[] {
    const rarity = entryRarity(entry);
    const allianceRequirement = requiredAlliance(entry.category);
    return roster.filter((unit) => available.has(unit.id) && isEligibleForBoard(unit, rarity, allianceRequirement));
  }

  function fillSlots(chosen: RosterCharacter[], pool: RosterCharacter[], slots: number): RosterCharacter[] {
    const chosenIds = new Set(chosen.map((u) => u.id));
    const padding = pool
      .filter((u) => !chosenIds.has(u.id))
      .sort(fillComparator)
      .slice(0, Math.max(0, slots - chosen.length));
    return [...chosen, ...padding];
  }

  // Phase A: objective-first greedy fill, highest rarity board first.
  for (const board of sortedBoards) {
    const eligible = eligibleAvailableRoster(board);
    const groups = groupObjectives(board.bonusObjectives).map((g) => ({ ...g, remaining: g.count }));
    const assigned: RosterCharacter[] = [];
    const tentativelyUsed = new Set<string>();

    while (assigned.length < board.participants) {
      let best: RosterCharacter | undefined;
      let bestScore = 0;
      for (const unit of eligible) {
        if (tentativelyUsed.has(unit.id)) continue;
        const score = groups.reduce(
          (n, g) => (g.remaining > 0 && characterSatisfiesObjective(unit.profile, g.objective) ? n + 1 : n),
          0,
        );
        if (score === 0) continue;
        if (!best || score > bestScore || (score === bestScore && fillComparator(unit, best) < 0)) {
          best = unit;
          bestScore = score;
        }
      }
      if (!best) break; // no available unit can make any more progress
      assigned.push(best);
      tentativelyUsed.add(best.id);
      for (const group of groups) {
        if (group.remaining > 0 && characterSatisfiesObjective(best.profile, group.objective)) {
          group.remaining -= 1;
        }
      }
      if (groups.every((g) => g.remaining === 0)) break;
    }

    if (groups.every((g) => g.remaining === 0)) {
      const filled = fillSlots(assigned, eligible, board.participants);
      if (filled.length === board.participants) {
        for (const unit of filled) available.delete(unit.id);
        const groupRequirements: GroupRequirement[] = groups.map((group) => ({
          key: group.key,
          count: group.count,
          eligibleAssignedIds: assigned.filter((u) => characterSatisfiesObjective(u.profile, group.objective)).map((u) => u.id),
        }));
        const required = findMinimalRequiredSubset(
          assigned.map((u) => u.id),
          groupRequirements,
        );
        solutions.set(board.expeditionId, {
          expeditionId: board.expeditionId,
          run: true,
          bonusCompleted: true,
          requiredCharacterIds: sortIdsByPower(required, powerById),
          optionalCharacterIds: sortIdsByPower(
            filled.map((u) => u.id).filter((id) => !required.has(id)),
            powerById,
          ),
        });
        continue;
      }
      // Objectives were covered, but there weren't enough eligible bodies left to also hit the
      // exact participant count - falls through to the unable bin like any other failure.
    }
    unableBoards.push(board);
  }

  // Phase B: rank-based fill for anything Phase A couldn't fully solve, still mythic-first.
  for (const board of unableBoards) {
    const eligible = eligibleAvailableRoster(board);
    const chosen = [...eligible].sort(fillComparator).slice(0, board.participants);
    if (chosen.length === board.participants) {
      for (const unit of chosen) available.delete(unit.id);
      solutions.set(board.expeditionId, {
        expeditionId: board.expeditionId,
        run: true,
        bonusCompleted: false,
        requiredCharacterIds: [],
        optionalCharacterIds: sortIdsByPower(
          chosen.map((u) => u.id),
          powerById,
        ),
      });
    } else {
      solutions.set(board.expeditionId, {
        expeditionId: board.expeditionId,
        run: false,
        bonusCompleted: false,
        requiredCharacterIds: [],
        optionalCharacterIds: [],
      });
    }
  }

  return solutions;
}

function extractSolution(
  built: BuiltModel,
  result: SolveResult,
  openBoardIds: string[],
  roster: RosterCharacter[],
): BoardAssignmentResult {
  const isOne = (name: string) => Math.round(Number(result[name] ?? 0)) === 1;
  const powerById = buildPowerById(roster);

  const assignedByBoard = new Map<string, Set<string>>();
  for (const ref of built.assignRefs) {
    if (!isOne(ref.varName)) continue;
    const set = assignedByBoard.get(ref.boardId) ?? new Set<string>();
    set.add(ref.characterId);
    assignedByBoard.set(ref.boardId, set);
  }

  const solutions: BoardAssignmentResult = new Map();
  for (const boardId of openBoardIds) {
    const run = isOne(built.runVarByBoard.get(boardId)!);
    const bonusCompleted = isOne(built.bonusVarByBoard.get(boardId)!);
    const assigned = assignedByBoard.get(boardId) ?? new Set<string>();

    if (run) {
      const entryParticipants = built.participantsByBoard.get(boardId);
      if (entryParticipants !== undefined && assigned.size !== entryParticipants) {
        console.error(
          `[board-solver] INVARIANT VIOLATION: board ${boardId} has ${assigned.size} assigned character(s) but ${entryParticipants} participant slot(s) - this should be impossible; the integrality check should have caught it upstream`,
        );
      }
    }

    let required = new Set<string>();
    if (bonusCompleted) {
      const groups = built.groupsByBoard.get(boardId) ?? [];
      const eligibleByGroup = built.eligibleCharactersByBoardGroup.get(boardId)!;
      const groupRequirements: GroupRequirement[] = groups.map((group) => ({
        key: group.key,
        count: group.count,
        eligibleAssignedIds: (eligibleByGroup.get(group.key) ?? []).filter((id) => assigned.has(id)),
      }));
      required = findMinimalRequiredSubset([...assigned], groupRequirements);
    }

    const optional = [...assigned].filter((id) => !required.has(id));

    solutions.set(boardId, {
      expeditionId: boardId,
      run,
      bonusCompleted,
      requiredCharacterIds: sortIdsByPower(required, powerById),
      optionalCharacterIds: sortIdsByPower(optional, powerById),
    });
  }
  return solutions;
}

// The message shown whenever the final assignment leaves any open board unrun - regardless of
// whether that came from a degraded LP pass, a greedy-fallback board it couldn't fully solve, or
// (in principle) an "ok" LP result that's still infeasible for some board's roster requirements.
// A greedy-fallback result that DOES fully cover the board is not warned about at all.
const INCOMPLETE_BOARD_MESSAGE =
  "Could not find an optimal board with priorities in the order you gave. Please try adjusting priority order.";

export interface SolveBoardAssignmentResult {
  assignment: BoardAssignmentResult;
  status: "ok" | "incomplete";
  message?: string;
}

export function solveBoardAssignment(
  board: ExpeditionBoardEntry[],
  heroes: RawUnit[],
  priorityOrder: [PriorityKey, PriorityKey, PriorityKey, PriorityKey],
  favoritedCharacterIds: ReadonlySet<string> = new Set(),
  antiFavoritedCharacterIds: ReadonlySet<string> = new Set(),
): SolveBoardAssignmentResult {
  const openBoards = board.filter((entry) => !entryIsUnavailable(entry));
  if (openBoards.length === 0) {
    return { assignment: new Map(), status: "ok" };
  }

  const roster = buildRoster(heroes, committedCharacterIds(board), favoritedCharacterIds, antiFavoritedCharacterIds);
  const built = buildModel(openBoards, roster, priorityOrder);
  const variableCount = Object.keys(built.model.variables).length;
  const constraintCount = Object.keys(built.model.constraints).length;
  console.log(
    `[board-solver] solving: ${openBoards.length} open board(s), ${roster.length} roster character(s), ${variableCount} variable(s), ${constraintCount} constraint(s)`,
  );
  const solveStartedAt = performance.now();
  const passesResult = runPasses(built.model);
  console.log(`[board-solver] total solve time: ${Math.round(performance.now() - solveStartedAt)}ms`);

  let assignment: BoardAssignmentResult;
  if (passesResult.result === null) {
    console.warn("[board-solver] LP failed entirely - falling back to the greedy heuristic solver");
    assignment = solveGreedyFallback(openBoards, roster);
  } else {
    assignment = extractSolution(
      built,
      passesResult.result,
      openBoards.map((entry) => entry.expeditionId),
      roster,
    );
  }

  const incomplete = [...assignment.values()].some((solution) => !solution.run);
  if (incomplete) {
    return { assignment, status: "incomplete", message: INCOMPLETE_BOARD_MESSAGE };
  }
  return { assignment, status: "ok" };
}

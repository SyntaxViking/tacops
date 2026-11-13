import solver, { type Model as LpModel, type SolveResult } from "javascript-lp-solver";
import { BoardFilter, type RankedUnit } from "./board-filter";
import { characterSatisfiesObjective } from "./objective-eligibility";
import { rewardAmount, type PriorityKey } from "./reward-amount";
import { estimateXpGain, isXpCapped } from "./xp-gain";
import { requiredAlliance } from "./board-alliance";
import { entryRarity, entryIsUnavailable } from "./board-view-model";
import { intToRank } from "../rank/rank.mapper";
import { Rarity } from "../rarity/rarity.enum";
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
    .filter((hero) => !excludedIds.has(hero.id) && isCharacterId(hero.id))
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
type PassKey = PriorityPassKey | "antiFavoriteCount" | "favoriteScore" | "xpGain";

// Strict rarity order, lowest first, used to build the rarity tier's weights (see rarityWeights).
const RARITIES_LOW_TO_HIGH: Rarity[] = [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary, Rarity.Mythic];

// Each priority tier is one pass, keyed by its position in the user's order.
function priorityPassKey(tierIndex: number): PriorityPassKey {
  return `priority${tierIndex}`;
}

// The rarity tier is a single pass whose per-operation weights make the ordering strict: one
// operation of a higher rarity is worth more than every lower-rarity operation on the board put
// together, so maximizing the weighted count of operations that run picks the combination that
// runs the most Mythic operations first, then the most Legendary, and so on - however many lower
// rarities it displaces. (A plain sum of rarity numbers would silently decide that, say, two
// Legendaries beat one Mythic - an arbitrary bias nobody chose.) Weights are built from the
// bottom up: the lowest rarity present is worth 1, and each higher rarity is worth 1 plus the
// total weight of every lower-rarity operation, which is the smallest value that guarantees the
// ordering and keeps the numbers small for the simplex solver.
export function rarityWeights(rarities: readonly Rarity[]): Map<Rarity, number> {
  const counts = new Map<Rarity, number>();
  for (const rarity of rarities) counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
  const weights = new Map<Rarity, number>();
  let lowerTotal = 0;
  for (const rarity of RARITIES_LOW_TO_HIGH) {
    const count = counts.get(rarity) ?? 0;
    if (count === 0) continue;
    const weight = lowerTotal + 1;
    weights.set(rarity, weight);
    lowerTotal += weight * count;
  }
  return weights;
}

interface PassSpec {
  key: PassKey;
  opType: "max" | "min";
}

// The first passes are the user's priority tiers in their chosen order (lexicographic - each pass's
// achieved value gets locked in via an `equal` constraint before the next pass runs, see
// runPasses), followed by the fixed tail that always applies regardless of priority order:
//   1. antiFavoriteCount (min) - avoid anti-favorited characters. A soft preference: it can only
//      choose among solutions that already satisfy every locked priority outcome, so an
//      anti-favorited character who is the only one that works still gets used.
//   2. favoriteScore (max) - use favorited characters.
//   3. xpGain (max) - earn the most XP. Last, so its value is never locked and the assignment it
//      finds is the final answer.
// Each tail pass only ever decides WHICH specific characters fill an already-decided set of
// run/bonus outcomes, so none of them can cost a bonus or a run.
function buildPassPlan(priorityOrder: readonly PriorityKey[]): PassSpec[] {
  const passes: PassSpec[] = priorityOrder.map((_, tierIndex) => ({ key: priorityPassKey(tierIndex), opType: "max" }));
  passes.push(
    { key: "antiFavoriteCount", opType: "min" },
    { key: "favoriteScore", opType: "max" },
    { key: "xpGain", opType: "max" },
  );
  return passes;
}

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
  const weightByRarity = rarityWeights(openBoards.map(entryRarity));

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
      if (key === "rarity") {
        // Rarity isn't tied to bonus-objective completion like the resource rewards below - it's
        // a property of running the board at all, so it credits runVar (this operation's weight -
        // see rarityWeights) instead of yVar.
        addCoef(runVar, priorityPassKey(tierIndex), weightByRarity.get(rarity) ?? 0);
      } else {
        addCoef(yVar, priorityPassKey(tierIndex), rewardAmount(entry.bonusRewards, key));
      }
    });

    const slotConstraint = `slots::${boardId}`;
    constraints[slotConstraint] = { equal: 0 };
    addCoef(runVar, slotConstraint, -entry.participants);

    const eligibleRoster = roster.filter((unit) => isEligibleForBoard(unit, rarity, allianceRequirement));

    for (const unit of eligibleRoster) {
      const assignVar = `assign::${unit.id}::${boardId}`;
      binaries[assignVar] = 1;
      addCoef(assignVar, slotConstraint, 1);
      addCoef(assignVar, `excl::${unit.id}`, 1);
      addCoef(assignVar, "antiFavoriteCount", unit.isAntiFavorited ? 1 : 0);
      addCoef(assignVar, "xpGain", estimateXpGain(rarity, unit.rarity, unit.xpLevel, unit.power));
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
    optimize: "xpGain",
    opType: "max",
    constraints,
    variables,
    binaries,
  };

  return { model, assignRefs, runVarByBoard, bonusVarByBoard, groupsByBoard, eligibleCharactersByBoardGroup, participantsByBoard };
}

// Safety net, not a tuned value - solver.Solve() runs synchronously (this library has no
// async/worker mode of its own; we run the whole module inside a Web Worker instead so this
// can't freeze the UI thread). This bounds the WHOLE lexicographic sequence (see runPasses), not
// each pass independently - model.timeout only ever bounds a single Solve() call (confirmed
// against the library's own source: it computes `terminalTime = Date.now() + model.timeout` fresh
// on every call), so setting the same value on every one of the passes let the real worst case
// reach 8x this - confirmed against a real hard instance where the UI looked permanently stuck
// because every pass independently ground through its own full timeout before anything ever
// reached the user.
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

// "partial" means the sequence stopped early (a pass timed out or came back unusable) and `result`
// is the last pass that DID complete - a full, valid assignment that's optimal for every criterion
// up to that pass and arbitrary beyond it. unfinishedPassKeys lists the passes that had anything to
// optimize but never completed. "failed" means not even the first pass produced a usable result.
type PassesResult =
  | { result: SolveResult; status: "ok" }
  | { result: SolveResult; status: "partial"; unfinishedPassKeys: PassKey[] }
  | { result: null; status: "failed" };

// Called after every usable pass that still has later passes with something to optimize. The
// final pass never checkpoints - its result is the return value.
type CheckpointHandler = (result: SolveResult, unfinishedPassKeys: PassKey[]) => void;

// A pass whose objective is zero for every variable (e.g. favoriteScore when the player has no
// favorites) can't change anything - every feasible solution scores 0 - so there's nothing to
// lock in or optimize. Running it anyway isn't just wasted work: maximizing a constant is a
// fully degenerate problem and javascript-lp-solver can fail to return from it at all, which
// its deadline can't interrupt (it's only checked between branch-and-bound nodes).
function passHasSignal(model: LpModel, pass: PassSpec): boolean {
  return Object.values(model.variables).some((coefficients) => (coefficients[pass.key] ?? 0) !== 0);
}

// If a later pass can't finish in time, the last pass that DID complete is still a fully valid,
// feasible assignment - just not optimized beyond that point. It's returned as "partial" for the
// caller to present as non-optimal. If even the first pass can't produce a usable result there's
// nothing to return - a normal "failed" outcome rather than an exception.
function runPasses(model: LpModel, passOrder: PassSpec[], onCheckpoint?: CheckpointHandler): PassesResult {
  // One shared deadline for the entire sequence - each pass's own model.timeout is however much
  // of that budget is still left, not a fresh SOLVE_TIMEOUT_MS every time (see SOLVE_TIMEOUT_MS's
  // own comment for why that matters).
  const deadline = Date.now() + SOLVE_TIMEOUT_MS;
  let lastGoodResult: SolveResult | undefined;
  const unfinishedFrom = (index: number): PassKey[] =>
    passOrder.slice(index).filter((pass) => passHasSignal(model, pass)).map((pass) => pass.key);
  const stopAt = (index: number): PassesResult =>
    lastGoodResult ? { result: lastGoodResult, status: "partial", unfinishedPassKeys: unfinishedFrom(index) } : { result: null, status: "failed" };

  for (let i = 0; i < passOrder.length; i++) {
    const pass = passOrder[i];
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      console.warn(`[board-solver] out of time before pass "${pass.key}" could even start`);
      return stopAt(i);
    }
    if (!passHasSignal(model, pass)) {
      console.log(`[board-solver] pass "${pass.key}" (${i + 1}/${passOrder.length}): skipped - objective is zero for every variable`);
      continue;
    }
    model.optimize = pass.key;
    model.opType = pass.opType;
    model.timeout = remainingMs;
    const startedAt = performance.now();
    const result = solver.Solve(model) as SolveResult;
    const elapsedMs = Math.round(performance.now() - startedAt);
    const hitTimeout = Date.now() >= deadline;
    // A timed-out branch-and-bound search can land on a value that happens to look feasible and
    // integral without actually being the true optimum for this pass - trusting it anyway would
    // lock in a possibly-wrong `equal` constraint for every later pass. Treat a timeout exactly
    // like "not usable" so this stops at the last fully-completed pass immediately.
    const isIntegral = result.feasible && isIntegralResult(model, result);
    const usable = !hitTimeout && isIntegral;
    console.log(
      `[board-solver] pass "${pass.key}" (${i + 1}/${passOrder.length}): feasible=${result.feasible} integral=${isIntegral} result=${result.result} took ${elapsedMs}ms${hitTimeout ? " (HIT TIMEOUT)" : ""}`,
    );
    if (!usable) {
      console.warn(`[board-solver] pass "${pass.key}" didn't produce a usable result${hitTimeout ? " (timed out)" : ""}`);
      return stopAt(i);
    }
    lastGoodResult = result;
    if (i < passOrder.length - 1) {
      model.constraints[pass.key] = { equal: Math.round(Number(result.result)) };
      const unfinished = unfinishedFrom(i + 1);
      if (unfinished.length > 0) onCheckpoint?.(result, unfinished);
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

// Shared "who to prefer" ordering for the greedy solver, mirroring the order the LP's tail passes
// optimize in: avoid anti-favorited characters first, then prefer favorited ones, then prefer
// whoever earns the most XP. XP is power-based (see estimateXpGain), and the operation's rarity
// scales everyone's XP by the same factor, so ranking units against each other only needs
// "XP-capped last, then higher power first" (falling back to last place, not 0, when power is
// unknown - an uncomputed power shouldn't look weaker than a genuinely low-power character).
// Negative return means `a` is preferred over `b`, matching Array.prototype.sort's contract.
function fillComparator(a: RosterCharacter, b: RosterCharacter): number {
  const aAnti = a.isAntiFavorited ? 1 : 0;
  const bAnti = b.isAntiFavorited ? 1 : 0;
  if (aAnti !== bAnti) return aAnti - bAnti;
  const aFav = a.isFavorited ? 1 : 0;
  const bFav = b.isFavorited ? 1 : 0;
  if (aFav !== bFav) return bFav - aFav;
  const aCapped = isXpCapped(a.rarity, a.xpLevel) ? 1 : 0;
  const bCapped = isXpCapped(b.rarity, b.xpLevel) ? 1 : 0;
  if (aCapped !== bCapped) return aCapped - bCapped;
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
// whether that came from a greedy result it couldn't fully solve or (in principle) an "ok" LP
// result that's still infeasible for some board's roster requirements. A greedy result that DOES
// fully cover the board is not warned about at all.
const INCOMPLETE_BOARD_MESSAGE =
  "Could not find an optimal board with priorities in the order you gave. Please try adjusting priority order.";

// "ok" - fully optimized. "partial" - the optimizer stopped early; `assignment` is the last pass
// that completed (optimal up to there, arbitrary beyond - see unfinishedPasses). "failed" - the
// optimizer produced nothing at all; `assignment` is empty. "incomplete" - at least one board
// couldn't be run at all.
export interface SolveBoardAssignmentResult {
  assignment: BoardAssignmentResult;
  status: "ok" | "partial" | "failed" | "incomplete";
  message?: string;
  // Human-readable names of the passes that never completed (partial only).
  unfinishedPasses?: string[];
}

const PRIORITY_LABELS: Record<PriorityKey, string> = {
  rarity: "rarity",
  crusadeBomb: "crusade bombs",
  intel: "intel",
  crusadeNpc: "crusade NPCs",
};

function passLabel(key: PassKey, priorityOrder: readonly PriorityKey[]): string {
  switch (key) {
    case "antiFavoriteCount":
      return "avoiding anti-favorites";
    case "favoriteScore":
      return "using favorites";
    case "xpGain":
      return "XP gain";
    default:
      return PRIORITY_LABELS[priorityOrder[Number(key.slice("priority".length))]];
  }
}

export function solveBoardAssignment(
  board: ExpeditionBoardEntry[],
  heroes: RawUnit[],
  priorityOrder: [PriorityKey, PriorityKey, PriorityKey, PriorityKey],
  favoritedCharacterIds: ReadonlySet<string> = new Set(),
  antiFavoritedCharacterIds: ReadonlySet<string> = new Set(),
  // True for the greedy worker (see board-solver.worker.ts): skips the LP entirely and uses the
  // greedy solver, which is polynomial with no search, so it can't hang the way the LP can.
  skipLp = false,
  // Receives the assignment from the last completed pass after every pass that still has later
  // passes to run. The worker forwards these to the page so a solve that later hangs inside
  // solver.Solve() - which can't be interrupted - still leaves a usable partial result behind.
  onCheckpoint?: (assignment: BoardAssignmentResult, unfinishedPasses: string[]) => void,
): SolveBoardAssignmentResult {
  const openBoards = board.filter((entry) => !entryIsUnavailable(entry));
  if (openBoards.length === 0) {
    return { assignment: new Map(), status: "ok" };
  }

  const roster = buildRoster(heroes, committedCharacterIds(board), favoritedCharacterIds, antiFavoritedCharacterIds);

  if (skipLp) {
    const assignment = solveGreedyFallback(openBoards, roster);
    const incomplete = [...assignment.values()].some((solution) => !solution.run);
    return incomplete ? { assignment, status: "incomplete", message: INCOMPLETE_BOARD_MESSAGE } : { assignment, status: "ok" };
  }

  const built = buildModel(openBoards, roster, priorityOrder);
  const variableCount = Object.keys(built.model.variables).length;
  const constraintCount = Object.keys(built.model.constraints).length;
  console.log(
    `[board-solver] solving: ${openBoards.length} open board(s), ${roster.length} roster character(s), ${variableCount} variable(s), ${constraintCount} constraint(s)`,
  );
  const openBoardIds = openBoards.map((entry) => entry.expeditionId);
  const labelsOf = (keys: PassKey[]) => keys.map((key) => passLabel(key, priorityOrder));
  const solveStartedAt = performance.now();
  const passesResult = runPasses(
    built.model,
    buildPassPlan(priorityOrder),
    onCheckpoint &&
      ((result, unfinishedPassKeys) => onCheckpoint(extractSolution(built, result, openBoardIds, roster), labelsOf(unfinishedPassKeys))),
  );
  console.log(`[board-solver] total solve time: ${Math.round(performance.now() - solveStartedAt)}ms`);

  if (passesResult.status === "failed") {
    console.warn("[board-solver] the optimizer produced no usable result at all");
    return { assignment: new Map(), status: "failed" };
  }

  const assignment = extractSolution(built, passesResult.result, openBoardIds, roster);
  if (passesResult.status === "partial") {
    return { assignment, status: "partial", unfinishedPasses: labelsOf(passesResult.unfinishedPassKeys) };
  }
  const incomplete = [...assignment.values()].some((solution) => !solution.run);
  return incomplete ? { assignment, status: "incomplete", message: INCOMPLETE_BOARD_MESSAGE } : { assignment, status: "ok" };
}

export interface DispatchedCharacterClassification {
  requiredIds: Set<string>;
  optionalIds: Set<string>;
}

// Classifies an ALREADY-DISPATCHED entry's own characters as required/optional against that
// entry's bonus objectives - same "smallest subset that still satisfies every objective group"
// logic as findMinimalRequiredSubset above, but over the fixed set of characters actually sent,
// not a hypothetical assignment choice (a dispatched board can't be reassigned, so there's no
// BoardSolution/requiredCharacterIds for it from the solver - this is a separate classification
// of what was already chosen, for DispatchedUnitsRow.tsx's own halo display). Non-character
// dispatched units (MoWs) are always "optional" - they can't satisfy a character-trait-based
// bonus objective. requiredIds comes back empty (everyone optional) when the entry has no bonus
// objectives at all, same as the solver's own bonusCompleted:false fallback.
export function classifyDispatchedCharacters(entry: ExpeditionBoardEntry, heroes: RawUnit[]): DispatchedCharacterClassification {
  const dispatchedIds = (entry.units ?? []).filter(isCharacterId);
  const heroById = new Map(heroes.map((h) => [h.id, h]));
  const profileById = new Map(dispatchedIds.map((id) => [id, getCharacterProfile(id, heroById.get(id)?.extraDamageProfiles)]));

  const groupRequirements: GroupRequirement[] = groupObjectives(entry.bonusObjectives).map((group) => ({
    key: group.key,
    count: group.count,
    eligibleAssignedIds: dispatchedIds.filter((id) => characterSatisfiesObjective(profileById.get(id)!, group.objective)),
  }));

  const requiredIds = findMinimalRequiredSubset(dispatchedIds, groupRequirements);
  return { requiredIds, optionalIds: new Set(dispatchedIds.filter((id) => !requiredIds.has(id))) };
}

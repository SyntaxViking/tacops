import { solveBoardAssignment, type BoardSolution } from "./board-solver";
import type { ExpeditionBoardEntry, RawUnit } from "../api/types";
import type { PriorityKey } from "./reward-amount";

export interface SolveRequest {
  requestId: number;
  board: ExpeditionBoardEntry[];
  heroes: RawUnit[];
  priorityOrder: [PriorityKey, PriorityKey, PriorityKey, PriorityKey];
  favoritedCharacterIds: string[];
  antiFavoritedCharacterIds: string[];
  // Selects the greedy solver instead of the LP - App.tsx runs one worker of each kind for every
  // solve. The greedy one can't hang the way the LP can.
  forceGreedy?: boolean;
}

// "status" here is the worker-protocol outcome: "success" is the final answer, "checkpoint" is an
// intermediate one, "error" means the call threw an unexpected exception.
//
// A checkpoint is the assignment from the last LP pass that completed so far, posted right after
// that pass finishes. solver.Solve() is synchronous and can't be interrupted, so if a later pass
// hangs the worker can never report anything again - the page keeps the newest checkpoint and
// shows it if the final answer never arrives.
//
// "solveStatus" is solveBoardAssignment's own normal, non-exceptional outcome: "ok" fully
// optimized; "partial" the optimizer stopped early (assignmentEntries is its last completed pass);
// "failed" the optimizer produced nothing; "incomplete" at least one board didn't end up fully
// assigned.
export type SolveResponse =
  | {
      requestId: number;
      status: "success";
      assignmentEntries: Array<[string, BoardSolution]>;
      solveStatus: "ok" | "partial" | "failed" | "incomplete";
      message?: string;
      unfinishedPasses?: string[];
    }
  | {
      requestId: number;
      status: "checkpoint";
      assignmentEntries: Array<[string, BoardSolution]>;
      unfinishedPasses: string[];
    }
  | {
      requestId: number;
      status: "error";
      error: string;
    };

self.onmessage = (event: MessageEvent<SolveRequest>) => {
  const { requestId, board, heroes, priorityOrder, favoritedCharacterIds, antiFavoritedCharacterIds, forceGreedy } = event.data;
  try {
    const { assignment, status, message, unfinishedPasses } = solveBoardAssignment(
      board,
      heroes,
      priorityOrder,
      new Set(favoritedCharacterIds),
      new Set(antiFavoritedCharacterIds),
      forceGreedy,
      (checkpointAssignment, unfinished) => {
        const checkpoint: SolveResponse = {
          requestId,
          status: "checkpoint",
          assignmentEntries: [...checkpointAssignment.entries()],
          unfinishedPasses: unfinished,
        };
        self.postMessage(checkpoint);
      },
    );
    const response: SolveResponse = {
      requestId,
      status: "success",
      assignmentEntries: [...assignment.entries()],
      solveStatus: status,
      message,
      unfinishedPasses,
    };
    self.postMessage(response);
  } catch (error) {
    const response: SolveResponse = { requestId, status: "error", error: `${error}` };
    self.postMessage(response);
  }
};

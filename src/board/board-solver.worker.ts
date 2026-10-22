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
  // Set by App.tsx's watchdog when a previous request for this same data never came back at all
  // (see its own comment) - skips the LP entirely and goes straight to the greedy fallback, which
  // can't hang the way the LP can.
  forceGreedy?: boolean;
}

// "status" here is the worker-protocol outcome (did the call throw an unexpected exception);
// "solveStatus" is solveBoardAssignment's own normal, non-exceptional outcome - "incomplete"
// means at least one board didn't end up fully assigned (whether the LP degraded, failed
// entirely, or the greedy fallback couldn't fully solve it), regardless of which path produced
// it - still a "success" at this level, just with a message worth surfacing.
export type SolveResponse =
  | {
      requestId: number;
      status: "success";
      assignmentEntries: Array<[string, BoardSolution]>;
      solveStatus: "ok" | "incomplete";
      message?: string;
    }
  | {
      requestId: number;
      status: "error";
      error: string;
    };

self.onmessage = (event: MessageEvent<SolveRequest>) => {
  const { requestId, board, heroes, priorityOrder, favoritedCharacterIds, antiFavoritedCharacterIds, forceGreedy } = event.data;
  try {
    const { assignment, status, message } = solveBoardAssignment(
      board,
      heroes,
      priorityOrder,
      new Set(favoritedCharacterIds),
      new Set(antiFavoritedCharacterIds),
      forceGreedy,
    );
    const response: SolveResponse = {
      requestId,
      status: "success",
      assignmentEntries: [...assignment.entries()],
      solveStatus: status,
      message,
    };
    self.postMessage(response);
  } catch (error) {
    const response: SolveResponse = { requestId, status: "error", error: `${error}` };
    self.postMessage(response);
  }
};

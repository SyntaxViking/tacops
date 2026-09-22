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
  const { requestId, board, heroes, priorityOrder, favoritedCharacterIds, antiFavoritedCharacterIds } = event.data;
  try {
    const { assignment, status, message } = solveBoardAssignment(
      board,
      heroes,
      priorityOrder,
      new Set(favoritedCharacterIds),
      new Set(antiFavoritedCharacterIds),
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

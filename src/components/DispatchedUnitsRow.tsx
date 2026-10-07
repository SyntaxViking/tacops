import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { getDispatchedUnits, entryFinishAt } from "../board/board-view-model";
import { classifyDispatchedCharacters } from "../board/board-solver";
import { formatDateTime } from "../format-date-time";
import type { ExpeditionBoardEntry, RawUnit } from "../api/types";

export function DispatchedUnitsRow({ entry, heroes }: { entry: ExpeditionBoardEntry; heroes: RawUnit[] }) {
  const dispatchedUnits = getDispatchedUnits(entry);
  if (!dispatchedUnits) {
    return null;
  }
  const powerById = new Map(heroes.map((hero) => [hero.id, hero.power ?? null]));
  const sortedUnits = [...dispatchedUnits].sort(
    (a, b) => (powerById.get(b.unitId) ?? -Infinity) - (powerById.get(a.unitId) ?? -Infinity),
  );
  // Same required/optional halo as the not-yet-dispatched suggested-characters list (see
  // OperationCard.tsx) - classified against this entry's own bonus objectives directly, since a
  // dispatched board has no BoardSolution from the solver (it can't be reassigned).
  const { requiredIds, optionalIds } = classifyDispatchedCharacters(entry, heroes);
  const finishAt = entryFinishAt(entry);
  return (
    <div className="flex flex-col items-start gap-1">
      <IconRow>
        {sortedUnits.map((unit) =>
          unit.portraitUrl ? (
            <Icon
              key={unit.unitId}
              src={unit.portraitUrl}
              title={unit.unitId}
              halo={requiredIds.has(unit.unitId) ? "required" : optionalIds.has(unit.unitId) ? "optional" : undefined}
            />
          ) : (
            <span key={unit.unitId}>{unit.unitId}</span>
          ),
        )}
      </IconRow>
      {finishAt !== null && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">Finishes: {formatDateTime(finishAt)}</span>
      )}
    </div>
  );
}

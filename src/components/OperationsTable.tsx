import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { IconBadge } from "./IconBadge";
import { AllianceCategoryBadge } from "./AllianceCategoryBadge";
import { RewardsCell } from "./RewardsCell";
import { PortraitList } from "./PortraitList";
import { DispatchedUnitsRow } from "./DispatchedUnitsRow";
import {
  sortByRarityDescending,
  entryRarityIconUrl,
  entryIsUnavailable,
  entryStatusLabel,
  getObjectiveDisplay,
} from "../board/board-view-model";
import { getEntryFulfillment, type EntryFulfillment } from "../board/entry-fulfillment";
import { operationName } from "../board/operation-name";
import { deployIconUrl } from "../board/deploy-icon";
import type { Environment, ExpeditionBoardEntry, RawUnit } from "../api/types";
import type { BoardAssignmentResult } from "../board/board-solver";

// Compact on purpose: on a phone, every operation should fit on one screen without scrolling down,
// so rows stay one line tall (nothing wraps) and the details that don't fit scroll sideways.
const cellClass = "whitespace-nowrap border-b border-black/10 px-2 py-1 align-middle dark:border-white/15";

// The first column - rarity plus the suggested characters - stays pinned while the rest of the row
// scrolls sideways under it, so the characters are always visible. It needs an opaque background
// (same as the page's) or the scrolled cells would show through it.
const stickyCellClass = `${cellClass} sticky left-0 z-20 bg-white dark:bg-neutral-900`;

// null = fulfillment isn't known yet (solver hasn't produced a result for the current board) -
// stay neutral rather than guessing. A left-edge accent keeps the shared grid lines (cellClass)
// untouched. "unrunnable" is red, "partial" (runs but misses a bonus objective) is amber,
// "complete" is green.
function rowAccentClass(fulfillment: EntryFulfillment | null): string {
  if (fulfillment === "complete") return "border-l-4 border-green-700/60 dark:border-green-500/60";
  if (fulfillment === "partial") return "border-l-4 border-amber-700/60 dark:border-amber-500/60";
  if (fulfillment === "unrunnable") return "border-l-4 border-red-700/60 dark:border-red-500/60";
  return "border-l-4 border-transparent";
}

export function OperationsTable({
  board,
  environment,
  assignment,
  solverReady,
  selectedExpeditionId,
  onSelect,
  heroes,
}: {
  board: ExpeditionBoardEntry[];
  environment: Environment;
  assignment: BoardAssignmentResult;
  solverReady: boolean;
  selectedExpeditionId: string | null;
  onSelect: (expeditionId: string) => void;
  heroes: RawUnit[];
}) {
  if (board.length === 0) {
    return <p>No expeditions on the board right now.</p>;
  }

  const sorted = sortByRarityDescending(board);

  return (
    <table className="mt-2 w-max min-w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={stickyCellClass}>Characters</th>
          <th className={cellClass}>
            <Icon src={deployIconUrl()} title="Participants" />
          </th>
          <th className={cellClass}>Bonus Objectives</th>
          <th className={cellClass}>Base Rewards</th>
          <th className={cellClass}>Bonus Rewards</th>
          <th className={cellClass}>Category</th>
          <th className={cellClass}>Name</th>
          <th className={cellClass}>Status</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((entry) => {
          const unavailable = entryIsUnavailable(entry);
          const solution = assignment.get(entry.expeditionId);
          const dimmed = selectedExpeditionId !== null && selectedExpeditionId !== entry.expeditionId;
          const name = operationName(entry.id);
          const fulfillment = unavailable || solverReady ? getEntryFulfillment(entry, assignment, heroes) : null;

          // Same combined, power-sorted list with a required/optional halo as the card view (see
          // OperationCard.tsx), so the characters read in the order to pick them.
          const requiredIds = solution?.run ? solution.requiredCharacterIds : [];
          const optionalIds = solution?.run ? solution.optionalCharacterIds : [];
          const powerById = new Map(heroes.map((hero) => [hero.id, hero.power ?? null]));
          const combinedIds = [...requiredIds, ...optionalIds].sort(
            (a, b) => (powerById.get(b) ?? -Infinity) - (powerById.get(a) ?? -Infinity),
          );
          const haloById = new Map<string, "required" | "optional">([
            ...requiredIds.map((id): [string, "required"] => [id, "required"]),
            ...optionalIds.map((id): [string, "optional"] => [id, "optional"]),
          ]);

          return (
            <tr
              key={entry.expeditionId}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(entry.expeditionId);
              }}
              className={`cursor-pointer transition-opacity ${rowAccentClass(fulfillment)} ${dimmed ? "opacity-20" : ""}`}
            >
              <td className={stickyCellClass}>
                <div className="flex items-center gap-2">
                  <Icon src={entryRarityIconUrl(entry)} size="sm" />
                  {unavailable ? (
                    <DispatchedUnitsRow entry={entry} heroes={heroes} size="sm" wrap={false} />
                  ) : (
                    <PortraitList ids={combinedIds} haloById={haloById} size="sm" wrap={false} />
                  )}
                </div>
              </td>
              <td className={cellClass}>{entry.participants}</td>
              <td className={cellClass}>
                <IconRow wrap={false}>
                  {entry.bonusObjectives.map((o, i) => {
                    const display = getObjectiveDisplay(o);
                    if (display.badge === "no-ranged-attack" && display.iconUrl) {
                      return <IconBadge key={i} src={display.iconUrl} title={display.label} />;
                    }
                    return display.iconUrl ? (
                      <Icon key={i} src={display.iconUrl} title={display.label} />
                    ) : (
                      <span key={i}>{display.label}</span>
                    );
                  })}
                </IconRow>
              </td>
              <td className={cellClass}>
                <RewardsCell rewards={entry.baseRewards ?? []} wrap={false} />
              </td>
              <td className={cellClass}>
                <RewardsCell rewards={entry.bonusRewards ?? []} wrap={false} />
              </td>
              <td className={cellClass}>
                <AllianceCategoryBadge entry={entry} />
              </td>
              <td className={cellClass}>
                {name ?? entry.id}
                {environment === "qa" && name && <span className="opacity-60"> ({entry.id})</span>}
              </td>
              <td className={cellClass}>{entryStatusLabel(entry)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

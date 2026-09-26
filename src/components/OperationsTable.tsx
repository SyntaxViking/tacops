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

const cellClass = "border-b border-black/10 px-3 py-2 align-top dark:border-white/15";

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
    <table className="mt-4 w-full table-auto border-collapse text-left">
      <thead>
        <tr>
          <th className={cellClass}>Rarity</th>
          <th className={cellClass}>Category</th>
          <th className={cellClass}>Name</th>
          <th className={cellClass}>
            <Icon src={deployIconUrl()} title="Participants" />
          </th>
          <th className={cellClass}>Bonus Objectives</th>
          <th className={cellClass}>Base Rewards</th>
          <th className={cellClass}>Bonus Rewards</th>
          <th className={cellClass}>Status</th>
          <th className={cellClass}>Required</th>
          <th className={cellClass}>Optional</th>
          <th className={cellClass}>Dispatched</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((entry) => {
          const unavailable = entryIsUnavailable(entry);
          const solution = assignment.get(entry.expeditionId);
          const dimmed = selectedExpeditionId !== null && selectedExpeditionId !== entry.expeditionId;
          const name = operationName(entry.id);
          const fulfillment = unavailable || solverReady ? getEntryFulfillment(entry, assignment, heroes) : null;

          return (
            <tr
              key={entry.expeditionId}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(entry.expeditionId);
              }}
              className={`cursor-pointer transition-opacity ${rowAccentClass(fulfillment)} ${dimmed ? "opacity-20" : ""}`}
            >
              <td className={cellClass}>
                <Icon src={entryRarityIconUrl(entry)} />
              </td>
              <td className={cellClass}>
                <AllianceCategoryBadge entry={entry} />
              </td>
              <td className={cellClass}>
                {name ?? entry.id}
                {environment === "qa" && name && <span className="opacity-60"> ({entry.id})</span>}
              </td>
              <td className={cellClass}>{entry.participants}</td>
              <td className={cellClass}>
                <IconRow>
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
                <RewardsCell rewards={entry.baseRewards ?? []} />
              </td>
              <td className={cellClass}>
                <RewardsCell rewards={entry.bonusRewards ?? []} />
              </td>
              <td className={cellClass}>{entryStatusLabel(entry)}</td>
              <td className={cellClass}>
                {!unavailable && <PortraitList ids={solution?.run ? solution.requiredCharacterIds : []} />}
              </td>
              <td className={cellClass}>
                {!unavailable && <PortraitList ids={solution?.run ? solution.optionalCharacterIds : []} />}
              </td>
              <td className={cellClass}>{unavailable && <DispatchedUnitsRow entry={entry} heroes={heroes} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { IconBadge } from "./IconBadge";
import { RewardsCell } from "./RewardsCell";
import { PortraitList } from "./PortraitList";
import { DispatchedUnitsRow } from "./DispatchedUnitsRow";
import { OpsCardFrame } from "./OpsCardFrame";
import { getObjectiveDisplay, entryIsUnavailable, entryStatusLabel } from "../board/board-view-model";
import { getEntryFulfillment } from "../board/entry-fulfillment";
import type { Environment, ExpeditionBoardEntry, RawUnit } from "../api/types";
import type { BoardAssignmentResult } from "../board/board-solver";

export function OperationCard({
  entry,
  environment,
  assignment,
  solverReady,
  selectedExpeditionId,
  onSelect,
  heroes,
}: {
  entry: ExpeditionBoardEntry;
  environment: Environment;
  assignment: BoardAssignmentResult;
  solverReady: boolean;
  selectedExpeditionId: string | null;
  onSelect: (expeditionId: string) => void;
  heroes: RawUnit[];
}) {
  const unavailable = entryIsUnavailable(entry);
  const solution = assignment.get(entry.expeditionId);
  const dimmed = selectedExpeditionId !== null && selectedExpeditionId !== entry.expeditionId;
  const fulfillment = unavailable || solverReady ? getEntryFulfillment(entry, assignment, heroes) : null;

  return (
    <OpsCardFrame
      entry={entry}
      environment={environment}
      corner={entryStatusLabel(entry)}
      dimmed={dimmed}
      fulfillment={fulfillment}
      onClick={() => onSelect(entry.expeditionId)}
    >
      <div className="flex justify-end">
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
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2">
          {unavailable ? (
            <DispatchedUnitsRow entry={entry} heroes={heroes} />
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">Required</span>
                <PortraitList ids={solution?.run ? solution.requiredCharacterIds : []} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">Optional</span>
                <PortraitList ids={solution?.run ? solution.optionalCharacterIds : []} />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs font-medium opacity-70">Base Rewards</span>
            <RewardsCell rewards={entry.baseRewards ?? []} />
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs font-medium opacity-70">Bonus Rewards</span>
            <RewardsCell rewards={entry.bonusRewards ?? []} />
          </div>
        </div>
      </div>
    </OpsCardFrame>
  );
}

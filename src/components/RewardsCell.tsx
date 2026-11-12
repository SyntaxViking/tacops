import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { getRewardChips } from "../board/board-view-model";

export function RewardsCell({ rewards, wrap }: { rewards: string[]; wrap?: boolean }) {
  return (
    <IconRow wrap={wrap}>
      {getRewardChips(rewards).map((chip, i) =>
        chip.iconUrl ? (
          <span key={i} className="inline-flex items-center gap-0.5">
            <Icon src={chip.iconUrl} />x{chip.amount}
          </span>
        ) : (
          <span key={i}>{chip.label}</span>
        ),
      )}
    </IconRow>
  );
}

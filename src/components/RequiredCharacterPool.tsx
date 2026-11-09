import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { characterPortraitUrl, hasCharacterPortrait } from "../characters/character-portraits";
import type { BoardAssignmentResult } from "../board/board-solver";
import type { RawUnit } from "../api/types";

export function RequiredCharacterPool({ assignment, heroes }: { assignment: BoardAssignmentResult; heroes: RawUnit[] }) {
  const requiredIds = new Set<string>();
  for (const solution of assignment.values()) {
    for (const id of solution.requiredCharacterIds) {
      requiredIds.add(id);
    }
  }

  if (requiredIds.size === 0) {
    return null;
  }

  const powerById = new Map(heroes.map((hero) => [hero.id, hero.power ?? null]));
  const sortedIds = [...requiredIds].sort(
    (a, b) => (powerById.get(b) ?? -Infinity) - (powerById.get(a) ?? -Infinity),
  );

  return (
    <div className="mt-4 w-full text-left">
      <h3 className="font-medium">Required characters (reserved by the suggested solution)</h3>
      <IconRow>
        {sortedIds.map((id) =>
          // See PortraitList's own comment - a recognized character id can still lack a mapped
          // portrait.
          hasCharacterPortrait(id) ? <Icon key={id} src={characterPortraitUrl(id)} title={id} /> : <span key={id}>{id}</span>,
        )}
      </IconRow>
    </div>
  );
}

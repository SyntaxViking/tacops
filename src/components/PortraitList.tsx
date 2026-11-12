import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { characterPortraitUrl, hasCharacterPortrait } from "../characters/character-portraits";

interface PortraitListProps {
  ids: string[];
  // Per-character halo (see Icon.tsx) - omitted entirely by callers that don't distinguish
  // required/optional (e.g. DispatchedUnitsRow), so most callers are unaffected by this.
  haloById?: ReadonlyMap<string, "required" | "optional">;
  // See Icon.tsx's own comment - only OperationCard's card-view list passes "sm".
  size?: "sm" | "md";
  // false keeps every portrait on one line (the compact operations table needs a fixed-width row).
  wrap?: boolean;
}

export function PortraitList({ ids, haloById, size, wrap }: PortraitListProps) {
  if (ids.length === 0) {
    return null;
  }
  return (
    <IconRow wrap={wrap}>
      {ids.map((id) =>
        // A recognized character id can still lack a mapped portrait (e.g. one added to
        // character-data.json before its portrait asset lands) - fall back to the id as text
        // instead of taking down the whole board view, same as DispatchedUnitsRow.
        hasCharacterPortrait(id) ? (
          <Icon key={id} src={characterPortraitUrl(id)} title={id} halo={haloById?.get(id)} size={size} />
        ) : (
          <span key={id}>{id}</span>
        ),
      )}
    </IconRow>
  );
}

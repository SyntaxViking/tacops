import { Icon } from "./Icon";
import { IconRow } from "./IconRow";
import { characterPortraitUrl } from "../characters/character-portraits";

interface PortraitListProps {
  ids: string[];
  // Per-character halo (see Icon.tsx) - omitted entirely by callers that don't distinguish
  // required/optional (e.g. DispatchedUnitsRow), so most callers are unaffected by this.
  haloById?: ReadonlyMap<string, "required" | "optional">;
}

export function PortraitList({ ids, haloById }: PortraitListProps) {
  if (ids.length === 0) {
    return null;
  }
  return (
    <IconRow>
      {ids.map((id) => (
        <Icon key={id} src={characterPortraitUrl(id)} title={id} halo={haloById?.get(id)} />
      ))}
    </IconRow>
  );
}

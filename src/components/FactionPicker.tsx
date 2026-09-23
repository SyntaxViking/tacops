import { Icon } from "./Icon";
import { factionIconUrl } from "../factions/faction-icon";
import { FACTION_SIDE } from "../factions/faction-side";

interface FactionPickerProps {
  selectedFactionId: string | null;
  onSelect: (factionId: string) => void;
}

// Lets an anonymous visitor (AnonymousCrusadeSection) pick a faction, which drives which side's
// leaderboard numbers lead on each planet and fires the DAU/WAU/MAU tracking ping - see
// AnonymousCrusadeSection.tsx. Purely a picker: it doesn't know or care which side each faction is
// on, that's FACTION_SIDE's job.
export function FactionPicker({ selectedFactionId, onSelect }: FactionPickerProps) {
  return (
    <div className="my-2 flex flex-col items-center gap-2">
      <p className="text-sm opacity-70">Pick a faction to see the crusade from its side</p>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {Object.keys(FACTION_SIDE).map((factionId) => {
          const url = factionIconUrl(factionId);
          const selected = factionId === selectedFactionId;
          return (
            <button
              key={factionId}
              type="button"
              title={factionId}
              onClick={() => onSelect(factionId)}
              className={`rounded-lg border p-1 transition-colors ${
                selected
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                  : "border-transparent hover:border-neutral-300 dark:hover:border-neutral-600"
              }`}
            >
              {url ? <Icon src={url} title={factionId} /> : <span className="text-xs">{factionId}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

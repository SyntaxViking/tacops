import type { CharacterSortMode } from "../characters/character-view-model";

const SORT_MODES: { value: CharacterSortMode; label: string }[] = [
  { value: "powerDesc", label: "Power (High to Low)" },
  { value: "nameAsc", label: "Name (A-Z)" },
  { value: "factionThenName", label: "Faction, then Name" },
];

interface CharacterSortModeToggleProps {
  value: CharacterSortMode;
  onChange: (value: CharacterSortMode) => void;
}

export function CharacterSortModeToggle({ value, onChange }: CharacterSortModeToggleProps) {
  return (
    <div className="my-2 flex flex-wrap justify-center gap-4">
      {SORT_MODES.map((mode) => (
        <label key={mode.value} className="flex cursor-pointer items-center gap-1">
          <input type="radio" name="characterSortMode" checked={value === mode.value} onChange={() => onChange(mode.value)} />
          {mode.label}
        </label>
      ))}
    </div>
  );
}

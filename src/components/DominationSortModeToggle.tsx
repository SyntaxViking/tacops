import type { DominationSortMode } from "../crusade/crusade-domination-view-model";

const SORT_MODES: { value: DominationSortMode; label: string }[] = [
  { value: "closestToCapture", label: "Closest to Capture" },
  { value: "imperialFirst", label: "Imperial, then Devastation" },
  { value: "devastationFirst", label: "Devastation, then Imperial" },
  { value: "highestPointsToCapture", label: "Highest Points to Capture" },
];

interface DominationSortModeToggleProps {
  value: DominationSortMode;
  onChange: (value: DominationSortMode) => void;
}

export function DominationSortModeToggle({ value, onChange }: DominationSortModeToggleProps) {
  return (
    <div className="my-2 flex flex-wrap justify-center gap-4">
      {SORT_MODES.map((mode) => (
        <label key={mode.value} className="flex cursor-pointer items-center gap-1">
          <input type="radio" name="dominationSortMode" checked={value === mode.value} onChange={() => onChange(mode.value)} />
          {mode.label}
        </label>
      ))}
    </div>
  );
}

const inputClass =
  "w-20 rounded border border-neutral-300 bg-white px-2 py-1 text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900/60 dark:text-white";

interface DominationTopTenFilterProps {
  maxSideInput: string;
  onChangeMaxSideInput: (value: string) => void;
  maxFactionInput: string;
  onChangeMaxFactionInput: (value: string) => void;
}

// Text (not number) inputs deliberately - an empty or non-numeric value just means "no filter"
// (see parsePositiveIntFilter), no need for a spinner or native number-input validation quirks.
export function DominationTopTenFilter({
  maxSideInput,
  onChangeMaxSideInput,
  maxFactionInput,
  onChangeMaxFactionInput,
}: DominationTopTenFilterProps) {
  return (
    <div className="my-2 flex flex-wrap items-center justify-center gap-4">
      <label className="flex items-center gap-2 text-sm">
        Max Top 25 Side
        <input type="text" inputMode="numeric" value={maxSideInput} onChange={(e) => onChangeMaxSideInput(e.target.value)} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        Max Top 10 Faction
        <input
          type="text"
          inputMode="numeric"
          value={maxFactionInput}
          onChange={(e) => onChangeMaxFactionInput(e.target.value)}
          className={inputClass}
        />
      </label>
    </div>
  );
}

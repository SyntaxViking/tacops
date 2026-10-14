const selectClass = "rounded border border-black/20 bg-white px-1 py-0.5 text-sm dark:border-white/20 dark:bg-neutral-900";

const HOUR_OPTIONS = Array.from({ length: 96 }, (_, i) => i + 1);

interface GraphHoursFilterProps {
  value: number; // may be Infinity
  onChange: (hours: number) => void;
}

// Number("Infinity") === Infinity round-trips natively in JS, so the "show everything" option
// needs no custom sentinel value.
export function GraphHoursFilter({ value, onChange }: GraphHoursFilterProps) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span>Most recent</span>
      <select className={selectClass} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="Infinity">∞</option>
        {HOUR_OPTIONS.map((hours) => (
          <option key={hours} value={hours}>
            {hours}
          </option>
        ))}
      </select>
      <span>Hours</span>
    </label>
  );
}

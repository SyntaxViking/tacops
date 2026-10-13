import { useEffect, useRef, useState } from "react";
import { OnslaughtRankBadge } from "./OnslaughtRankBadge";
import type { OnslaughtTierBoard } from "../api/types";

interface OnslaughtRankSelectProps {
  tiers: OnslaughtTierBoard[];
  value: number | null;
  onChange: (tier: number) => void;
}

// A native <select> can't render images inside its <option>s, so this is a small custom combobox
// built from the same onslaught rank badges (frame + rank icon) used elsewhere - a button showing
// the current selection that opens a panel of the alliance's other available tiers to pick from.
export function OnslaughtRankSelect({ tiers, value, onChange }: OnslaughtRankSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = tiers.find((t) => t.tier === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (tiers.length === 0) {
    return <span className="text-xs text-neutral-500 dark:text-neutral-400">No data yet</span>;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="flex items-center rounded border border-black/20 bg-white px-1 py-0.5 dark:border-white/20 dark:bg-neutral-900"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <OnslaughtRankBadge tier={selected.tier} isChallenge={selected.isChallenge} className="h-8" />
        ) : (
          <span className="px-1 text-xs text-neutral-500 dark:text-neutral-400">Select</span>
        )}
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-10 mt-1 flex max-h-64 w-max flex-col gap-1 overflow-y-auto rounded border border-black/20 bg-white p-1.5 shadow-lg dark:border-white/20 dark:bg-neutral-900"
        >
          {tiers.map((t) => (
            <button
              key={t.tier}
              type="button"
              role="option"
              aria-selected={t.tier === value}
              className={`rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10 ${t.tier === value ? "ring-2 ring-blue-500" : ""}`}
              onClick={() => {
                onChange(t.tier);
                setOpen(false);
              }}
            >
              <OnslaughtRankBadge tier={t.tier} isChallenge={t.isChallenge} className="h-10" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  // Screen position of the open panel, in `position: fixed` terms (top/right from the viewport
  // edge) - computed from the trigger button's own live bounding rect rather than a plain CSS
  // `absolute` offset. App.tsx's shared tab-content wrapper has `overflow-x-auto`, which (per the
  // CSS spec's overflow-axis-pairing rule - setting one axis non-visible forces the other to
  // resolve to `auto` too, it can't stay `visible`) also clips vertically. A card with no map
  // loaded yet is short enough that the panel's downward extent exceeded that wrapper's own
  // content height and got cut off; a card with a map loaded happened to have enough room not to
  // notice. `position: fixed` escapes that ancestor entirely (same technique Modal.tsx already
  // uses for its own overlay), so this needs to track the trigger's position explicitly instead
  // of relying on the browser to do it implicitly via `absolute`.
  const [panelPosition, setPanelPosition] = useState<{ top: number; right: number } | null>(null);
  const selected = tiers.find((t) => t.tier === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setPanelPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
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
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
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
      {open && panelPosition && (
        <div
          role="listbox"
          style={{ top: panelPosition.top, right: panelPosition.right }}
          className="fixed z-50 flex max-h-64 w-max flex-col gap-1 overflow-y-auto rounded border border-black/20 bg-white p-1.5 shadow-lg dark:border-white/20 dark:bg-neutral-900"
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

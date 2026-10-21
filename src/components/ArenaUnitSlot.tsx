import { ArenaEquipmentSlot } from "./ArenaEquipmentSlot";
import { rarityHaloFilter } from "../rarity/rarity-halo";
import { isMythicWingsIconUrl } from "../rarity/rarity-stars-icon";
import type { PvpUnitSlot } from "../pvp/pvp-view-model";

// 83px portrait (64px * 1.3) - grown ~30% so 3 fit per row within a card instead of 4. Ability
// levels sit back where they originally did (a separate block below the portrait, pulled up via
// negative margin to overlap its bottom edge) - but now with an explicit `relative z-10` so they
// reliably paint in front of the portrait/halo's own stacking context (isolation: isolate below),
// rather than relying on implicit DOM-order painting across that boundary.
export function ArenaUnitSlot({ unit }: { unit: PvpUnitSlot }) {
  return (
    <div className="flex w-[83px] flex-col items-center gap-1">
      {unit.starIconUrls.length > 0 && (
        <div className="flex gap-px">
          {unit.starIconUrls.map((url, i) => (
            <img key={i} src={url} className={isMythicWingsIconUrl(url) ? "h-4 w-auto" : "h-4 w-4"} />
          ))}
        </div>
      )}
      {/* isolation: isolate - same fix as Icon.tsx's halo: without its own stacking context, the
          drop-shadow's paint region can get clipped at a CSS Grid row's stretched (align-items:
          stretch) last row, since the 3 opponent cards sit in a grid (ArenaTab.tsx). */}
      <div className="relative h-[83px] w-[83px]" style={{ isolation: "isolate" }}>
        <img
          src={unit.portraitUrl}
          title={unit.name}
          className="h-[83px] w-[83px] rounded-full object-cover"
          style={{ filter: rarityHaloFilter(unit.rarity) }}
        />
        {unit.kind === "character" && (
          <img
            src={unit.rankIconUrl}
            title="Rank"
            className="absolute -bottom-[10px] left-1/2 h-[31px] w-[31px] -translate-x-1/2 rounded-full"
          />
        )}
      </div>
      <div className="relative z-10 -mt-[18px] flex w-full justify-between px-1 text-xs font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        <span title="Active ability level">{unit.activeLevel ?? "-"}</span>
        <span title="Passive ability level">{unit.passiveLevel ?? "-"}</span>
      </div>
      {unit.kind === "character" && (
        <div className="mt-1 flex gap-1">
          {unit.equipment.map((equipment, i) => (
            <ArenaEquipmentSlot key={i} equipment={equipment} />
          ))}
        </div>
      )}
    </div>
  );
}

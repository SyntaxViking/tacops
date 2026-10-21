import { isMythicWingsIconUrl } from "../rarity/rarity-stars-icon";
import type { RenderableQuestUnit } from "../hero-quests/quest-roster-view-model";

// Same layout as ArenaUnitSlot (stars, haloed portrait with the rank badge hanging off its
// bottom-left, active/passive ability levels below) minus equipment - a quest replay has no
// equipment data at all, unlike a live PvP roster.
export function QuestUnitSlot({ unit }: { unit: RenderableQuestUnit }) {
  return (
    <div className="flex w-[70px] flex-col items-center gap-1">
      {unit.starIconUrls.length > 0 && (
        <div className="flex gap-px">
          {unit.starIconUrls.map((url, i) => (
            <img key={i} src={url} className={isMythicWingsIconUrl(url) ? "h-3.5 w-auto" : "h-3.5 w-3.5"} />
          ))}
        </div>
      )}
      <div className="relative h-[70px] w-[70px]" style={{ isolation: "isolate" }}>
        {unit.portraitUrl ? (
          <img
            src={unit.portraitUrl}
            title={unit.unitId}
            className="h-[70px] w-[70px] rounded-full object-cover"
            style={unit.haloFilter ? { filter: unit.haloFilter } : undefined}
          />
        ) : (
          <span className="flex h-[70px] w-[70px] items-center justify-center break-all rounded-full bg-black/10 text-[9px] dark:bg-white/10">
            {unit.unitId}
          </span>
        )}
        {unit.rankIconUrl && (
          <img
            src={unit.rankIconUrl}
            title="Rank"
            className="absolute -bottom-[8px] left-1/2 h-[27px] w-[27px] -translate-x-1/2 rounded-full"
          />
        )}
      </div>
      {(unit.activeAbilityLevel !== null || unit.passiveAbilityLevel !== null) && (
        <div className="relative z-10 -mt-[14px] flex w-full justify-between px-1 text-xs font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
          <span title="Active ability level">{unit.activeAbilityLevel ?? "-"}</span>
          <span title="Passive ability level">{unit.passiveAbilityLevel ?? "-"}</span>
        </div>
      )}
    </div>
  );
}

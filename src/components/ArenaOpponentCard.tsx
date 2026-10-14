import { ArenaUnitSlot } from "./ArenaUnitSlot";
import { ArenaBoardMap } from "./ArenaBoardMap";
import type { PvpOpponentCard } from "../pvp/pvp-view-model";

// Same card-shell convention as OpsCardFrame.tsx (rounded border + light/dark background pair),
// just without that component's Operations-specific corner/footer slots.
export function ArenaOpponentCard({ card }: { card: PvpOpponentCard }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-black/10 bg-white p-3 text-left shadow-sm dark:border-white/15 dark:bg-neutral-900/40">
      <div className="flex items-center gap-2">
        <div className="relative h-10 w-10">
          {card.avatarUrl && <img src={card.avatarUrl} className="h-10 w-10 rounded-full object-cover" />}
          {card.avatarFrameUrl && <img src={card.avatarFrameUrl} className="absolute inset-0 h-full w-full" />}
        </div>
        <div className="flex flex-col">
          <span className="font-medium">{card.displayName}</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Level {card.level} · {card.rating} rating
          </span>
        </div>
        <div className="ml-auto flex flex-col items-end text-xs" title="Rating change for winning/losing this match">
          <span className="font-semibold text-green-600 dark:text-green-400">+{card.ratingGain}</span>
          <span className="font-semibold text-red-600 dark:text-red-400">-{card.ratingLoss}</span>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {card.units.map((unit) => (
          <ArenaUnitSlot key={unit.kind === "character" ? unit.characterId : unit.mowId} unit={unit} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        <ArenaBoardMap boardId={card.boardId} spawnPointsSet={card.spawnPointsSet} lineup={card.lineup} />
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{card.boardId}</span>
      </div>
    </div>
  );
}

import { useState } from "react";
import { rarityIconUrlForCap } from "../guild-war/guild-war-lineup-view-model";
import { GuildWarSiteDetail } from "./GuildWarSiteDetail";
import type { GuildWarBattlefield, GuildWarData, GuildWarLineup, GuildWarSite } from "../api/types";

type Side = "attack" | "defense";

const SIDES: { value: Side; label: string }[] = [
  { value: "attack", label: "Attack" },
  { value: "defense", label: "Defense" },
];

interface GuildWarTabProps {
  guildWar: GuildWarData;
}

// One lineup's row - its rarity cap icon (scaled down to dot size) on the left, then a character
// circle per unit: red for one still standing, a dark gray for one already defeated (either
// individually, via its own persisted remainingHp, or because its whole lineup was wiped - see
// guild-war-extraction.ts).
function LineupRow({ lineup, lineupIndex, rarityCap }: { lineup: GuildWarLineup; lineupIndex: number; rarityCap?: string }) {
  const iconUrl = rarityCap !== undefined ? rarityIconUrlForCap(rarityCap) : null;
  return (
    <div className="flex items-center justify-center gap-0.5">
      {iconUrl && <img src={iconUrl} title={`${rarityCap} cap`} className="h-2.5 w-2.5" />}
      {lineup.characters.map((character, i) => (
        <span
          key={`${lineupIndex}-${i}-${character.unitId}`}
          title={character.unitId}
          className={`h-2.5 w-2.5 rounded-full ${character.defeated ? "bg-neutral-800 dark:bg-neutral-950" : "bg-red-600"}`}
        />
      ))}
    </div>
  );
}

function SiteCell({ site, onSelect }: { site: GuildWarSite; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="flex cursor-pointer flex-col gap-1 rounded-lg border border-black/10 bg-white p-2 text-center text-xs shadow-sm transition hover:border-black/30 hover:shadow-md dark:border-white/15 dark:bg-neutral-900/40 dark:hover:border-white/30"
    >
      <div>{site.zoneType ?? "(hidden)"}</div>
      {site.players && (
        <div className="grid grid-cols-2 gap-x-2">
          {site.players.map((lineups, playerIndex) => (
            <div key={playerIndex} className="flex flex-col gap-1">
              {lineups.map((lineup, lineupIndex) => (
                <LineupRow key={lineupIndex} lineup={lineup} lineupIndex={lineupIndex} rarityCap={site.rarityCaps?.[lineupIndex]} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BattlefieldGrid({ battlefield, onSelectSite }: { battlefield: GuildWarBattlefield; onSelectSite: (site: GuildWarSite) => void }) {
  // Row 0 is the front line - rendered at the bottom of the grid to match the game's own window.
  const rowsBottomToTop = [...battlefield].reverse();

  return (
    <div className="flex flex-col gap-2">
      {rowsBottomToTop.map((row, displayIndex) => (
        <div key={displayIndex} className="grid grid-cols-3 gap-2">
          {row.map((site) => (
            <SiteCell key={site.zoneId} site={site} onSelect={() => onSelectSite(site)} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function GuildWarTab({ guildWar }: GuildWarTabProps) {
  const [side, setSide] = useState<Side>("attack");
  const [selectedSite, setSelectedSite] = useState<GuildWarSite | null>(null);
  const battlefield = guildWar[side];

  if (selectedSite) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 text-left">
        <GuildWarSiteDetail site={selectedSite} onBack={() => setSelectedSite(null)} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 text-left">
      <div className="my-2 flex justify-center gap-4">
        {SIDES.map((s) => (
          <label key={s.value} className="flex cursor-pointer items-center gap-1">
            <input type="radio" name="guildWarSide" checked={side === s.value} onChange={() => setSide(s.value)} />
            {s.label}
          </label>
        ))}
      </div>
      {battlefield ? (
        <BattlefieldGrid battlefield={battlefield} onSelectSite={setSelectedSite} />
      ) : (
        <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">No active guild war right now.</p>
      )}
    </div>
  );
}

import { useState } from "react";
import { GuildWarLineupRow } from "./GuildWarLineupRow";
import { GuildWarSiteBoardMap, type GuildWarLineupSelection } from "./GuildWarSiteBoardMap";
import type { GuildWarSite } from "../api/types";

interface GuildWarSiteDetailProps {
  site: GuildWarSite;
  onBack: () => void;
}

interface SelectedLineup {
  playerIndex: 0 | 1;
  lineupIndex: number;
}

export function GuildWarSiteDetail({ site, onBack }: GuildWarSiteDetailProps) {
  const [selected, setSelected] = useState<SelectedLineup | null>(null);

  const selectedLineup = selected ? site.players?.[selected.playerIndex][selected.lineupIndex] : undefined;
  const selection: GuildWarLineupSelection | null = selected && selectedLineup
    ? {
        // Both players place from player 2's spawn point group (teamWithPlayerIndex 1), not
        // player 1's own index - confirmed by the user, not yet by us independently (see
        // GuildWarSiteBoardMap's own comment).
        characterIds: selectedLineup.characters.map((c) => c.unitId),
        defeatedByCharacterId: new Map(selectedLineup.characters.map((c) => [c.unitId, c.defeated])),
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to battlefield
      </button>

      <div className="flex flex-wrap items-start gap-4">
        <h2 className="text-lg font-semibold">{site.zoneType ?? "(hidden)"}</h2>
        {site.boardId && (
          <div className="w-56">
            <GuildWarSiteBoardMap boardId={site.boardId} spawnPointsSet={site.spawnPointsSet} selection={selection} />
          </div>
        )}
      </div>

      {site.players ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {site.players.map((lineups, playerIndex) => (
            <div key={playerIndex} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Player {playerIndex + 1}</h3>
              {lineups.map((lineup, lineupIndex) => (
                <GuildWarLineupRow
                  key={lineupIndex}
                  lineup={lineup}
                  rarityCap={site.rarityCaps?.[lineupIndex]}
                  selected={selected?.playerIndex === playerIndex && selected?.lineupIndex === lineupIndex}
                  onClick={() =>
                    setSelected((current) =>
                      current?.playerIndex === playerIndex && current?.lineupIndex === lineupIndex
                        ? null
                        : { playerIndex: playerIndex as 0 | 1, lineupIndex },
                    )
                  }
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">This site hasn't been revealed yet.</p>
      )}
    </div>
  );
}

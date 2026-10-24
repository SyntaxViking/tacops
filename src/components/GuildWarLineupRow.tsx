import { isMythicWingsIconUrl } from "../rarity/rarity-stars-icon";
import { rarityHaloFilter } from "../rarity/rarity-halo";
import { ProgressionIndexMapper } from "../progression/progression-index";
import { getGuildWarCharacterRow, getGuildWarMowRow, rarityIconUrlForCap } from "../guild-war/guild-war-lineup-view-model";
import type { Rarity } from "../rarity/rarity.enum";
import type { GuildWarCharacterSlot, GuildWarLineup, GuildWarMachineOfWar } from "../api/types";

// A unit's portrait (glowing with a rarity-colored halo in place of a separate rarity badge -
// same technique as ArenaUnitSlot) + overlaid rank (characters only, bottom-left) and star
// cluster (centered on the top edge, 30% overlapping down onto the portrait), and its ability
// levels underneath - grayed out and dimmed once defeated.
function UnitBadge({
  name,
  portraitUrl,
  rankIconUrl,
  rarity,
  starIconUrls,
  activeAbilityLevel,
  passiveAbilityLevel,
  defeated,
}: {
  name: string;
  portraitUrl: string;
  rankIconUrl?: string;
  rarity: Rarity;
  starIconUrls: string[];
  activeAbilityLevel?: number;
  passiveAbilityLevel?: number;
  defeated: boolean;
}) {
  return (
    <div className={`flex w-14 flex-col items-center gap-0.5 ${defeated ? "opacity-40 grayscale" : ""}`}>
      {/* isolation: isolate - without its own stacking context, the halo's drop-shadow can get
          clipped at a flex-wrap/grid row boundary (same fix as Icon.tsx's and ArenaUnitSlot's
          own halos). */}
      <div className="relative h-14 w-14" style={{ isolation: "isolate" }}>
        <img
          src={portraitUrl}
          title={name}
          className="h-14 w-14 rounded-full object-cover"
          style={{ filter: rarityHaloFilter(rarity) }}
        />
        {rankIconUrl && <img src={rankIconUrl} title="Rank" className="absolute -bottom-1 -left-1 h-4 w-4 rounded-full" />}
        {starIconUrls.length > 0 && (
          <div className="absolute top-0 left-1/2 flex -translate-x-1/2 -translate-y-[70%] gap-px">
            {starIconUrls.map((url, i) => (
              <img key={i} src={url} className={isMythicWingsIconUrl(url) ? "h-2.5 w-auto" : "h-2.5 w-2.5"} />
            ))}
          </div>
        )}
      </div>
      <span className="text-center text-[10px] leading-tight text-neutral-600 dark:text-neutral-400">
        {activeAbilityLevel ?? "-"}/{passiveAbilityLevel ?? "-"}
      </span>
    </div>
  );
}

function fallbackBadge(unitId: string, defeated: boolean) {
  return (
    <div className={`flex w-14 flex-col items-center gap-0.5 text-center text-[10px] ${defeated ? "opacity-40 grayscale" : ""}`}>
      <span className="h-14 w-14 rounded-full bg-neutral-300 dark:bg-neutral-700" />
      <span className="break-all">{unitId}</span>
    </div>
  );
}

function CharacterBadge({ character }: { character: GuildWarCharacterSlot }) {
  const row = getGuildWarCharacterRow(character);
  if (!row) return fallbackBadge(character.unitId, character.defeated);
  return (
    <UnitBadge
      name={row.name}
      portraitUrl={row.portraitUrl}
      rankIconUrl={row.rankIconUrl}
      rarity={ProgressionIndexMapper.toRarity(character.progressionIndex)}
      starIconUrls={row.starIconUrls}
      activeAbilityLevel={character.activeAbilityLevel}
      passiveAbilityLevel={character.passiveAbilityLevel}
      defeated={character.defeated}
    />
  );
}

function MowBadge({ mow }: { mow: GuildWarMachineOfWar }) {
  const row = getGuildWarMowRow(mow);
  if (!row) return fallbackBadge(mow.unitId, mow.defeated);
  return (
    <UnitBadge
      name={row.name}
      portraitUrl={row.portraitUrl}
      rarity={ProgressionIndexMapper.toRarity(mow.progressionIndex)}
      starIconUrls={row.starIconUrls}
      activeAbilityLevel={mow.activeAbilityLevel}
      passiveAbilityLevel={mow.passiveAbilityLevel}
      defeated={mow.defeated}
    />
  );
}

// One lineup slot within a site's detail view: its rarity cap icon on the left, then its 5
// character badges and machine of war badge. Clicking it selects it (see GuildWarSiteDetail),
// which places these same characters on the site's board thumbnail.
export function GuildWarLineupRow({
  lineup,
  rarityCap,
  selected,
  onClick,
}: {
  lineup: GuildWarLineup;
  rarityCap?: string;
  selected: boolean;
  onClick: () => void;
}) {
  const capIconUrl = rarityCap !== undefined ? rarityIconUrlForCap(rarityCap) : null;

  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition ${
        selected
          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
          : "border-black/10 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
      }`}
    >
      {capIconUrl && <img src={capIconUrl} title={`${rarityCap} cap`} className="h-5 w-5 shrink-0" />}
      <div className="flex flex-wrap gap-1">
        {lineup.characters.map((character, i) => (
          <CharacterBadge key={`${character.unitId}-${i}`} character={character} />
        ))}
        {lineup.machineOfWar && <MowBadge mow={lineup.machineOfWar} />}
      </div>
    </div>
  );
}

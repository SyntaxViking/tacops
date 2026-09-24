import { useState } from "react";
import { Icon } from "./Icon";
import { watchAdIconUrl } from "../watch-ad-icon";
import { PVP_MAX } from "../api/resource-regen";
import { formatDateTime, urgencyColorClass, DEFAULT_SUBTEXT_CLASS } from "../format-date-time";
import {
  guildBossBombIconUrl,
  guildBossIconUrl,
  heroQuestIconUrl,
  mowAmmoIconUrl,
  pvpIconUrl,
  staminaIconUrl,
  survivalIconUrl,
  treasureBeachIconUrl,
  wavesIconUrl,
} from "../resource-icons";
import type { PlayerResources } from "../api/types";

interface ResourceTokensProps {
  resources: PlayerResources;
  adViewsRemaining: number | null;
}

interface SubtextLine {
  text: string;
  className: string;
}

const MOBILE_TOKENS_OPEN_KEY = "tacops:mobileTokensOpen";

// "Next token" is never urgency-colored (there's nothing to warn about), but "Cap"/"Burn" lines
// are deadlines worth calling out as they approach - see urgencyColorClass.
function regenSubtext(nextTokenAt: number | null, capAt: number | null): SubtextLine[] {
  const lines: SubtextLine[] = [];
  if (nextTokenAt !== null) lines.push({ text: `Next: ${formatDateTime(nextTokenAt)}`, className: DEFAULT_SUBTEXT_CLASS });
  if (capAt !== null) lines.push({ text: `Cap: ${formatDateTime(capAt)}`, className: urgencyColorClass(capAt) });
  return lines;
}

export function ResourceTokens({ resources, adViewsRemaining }: ResourceTokensProps) {
  // Remembered across visits on mobile only - desktop always shows the full row and never
  // consults this. Read lazily via the initializer so a stale/blocked localStorage doesn't
  // throw during render.
  const [mobileOpen, setMobileOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MOBILE_TOKENS_OPEN_KEY) === "true";
    } catch {
      return false;
    }
  });

  function toggleMobileOpen() {
    setMobileOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(MOBILE_TOKENS_OPEN_KEY, String(next));
      } catch {
        // localStorage unavailable (private mode, quota, etc.) - toggle still works, just won't persist.
      }
      return next;
    });
  }

  // Absent between PVP seasons - just omit the line rather than showing a misleading "0 / 0".
  const pvpPositionLine =
    resources.pvpPosition !== null && resources.pvpGroupSize !== null
      ? `${resources.pvpPosition} / ${resources.pvpGroupSize}`
      : null;
  // PVP's "next token" comes from the server's own staminaRegenUntil deadline, not computed
  // regen math - see computePvpTimings in resource-regen.ts for the three possible states.
  const pvpScheduleLines: SubtextLine[] = resources.pvpStopped
    ? [{ text: `${resources.pvp}/${PVP_MAX} (no more regen)`, className: DEFAULT_SUBTEXT_CLASS }]
    : [
        resources.pvpNextTokenAt !== null
          ? { text: `Next: ${formatDateTime(resources.pvpNextTokenAt)}`, className: DEFAULT_SUBTEXT_CLASS }
          : null,
        resources.pvpCapAt !== null
          ? { text: `Cap: ${formatDateTime(resources.pvpCapAt)}`, className: urgencyColorClass(resources.pvpCapAt) }
          : resources.pvpPausesAt !== null
            ? { text: `Pauses: ${formatDateTime(resources.pvpPausesAt)}`, className: DEFAULT_SUBTEXT_CLASS }
            : null,
      ].filter((line): line is SubtextLine => line !== null);
  const pvpPositionSubtext: SubtextLine[] = pvpPositionLine ? [{ text: pvpPositionLine, className: DEFAULT_SUBTEXT_CLASS }] : [];
  const pvpSubtext = [...pvpPositionSubtext, ...pvpScheduleLines];

  // Raid tokens (guild boss attempts) get burned at the next 09:45/22:45 UTC checkpoint if still
  // sitting at cap then - common when waiting for a raid target to open, so this is a deadline to
  // watch, not an error state. It gets the same urgency coloring as a cap time - it'll typically
  // land on a different tier/color than the cap line above it, since it's a different timestamp.
  const guildBossSubtext: SubtextLine[] = [
    ...regenSubtext(resources.guildBossNextTokenAt, resources.guildBossCapAt),
    ...(resources.guildBossBurnAt !== null
      ? [{ text: `Burn: ${formatDateTime(resources.guildBossBurnAt)}`, className: urgencyColorClass(resources.guildBossBurnAt) }]
      : []),
  ];

  const entries: Array<{
    key: string;
    label: string;
    icon: string;
    value: number | string;
    subtext?: SubtextLine[];
    disabled?: boolean;
  }> = [
    {
      key: "stamina",
      label: "Stamina",
      icon: staminaIconUrl(),
      value: resources.stamina,
      subtext: regenSubtext(resources.staminaNextTokenAt, resources.staminaCapAt),
    },
    // Written defensively rather than assuming adViewsRemaining is always set by the time this
    // renders - a genuine 0 must still show as 0, never silently hidden by a truthiness check.
    { key: "adViews", label: "Ad views remaining", icon: watchAdIconUrl(), value: adViewsRemaining === null ? "null" : adViewsRemaining },
    {
      key: "treasureBeach",
      label: "Salvage Run",
      icon: treasureBeachIconUrl(),
      value: resources.treasureBeach,
      subtext: regenSubtext(resources.treasureBeachNextTokenAt, resources.treasureBeachCapAt),
    },
    {
      key: "waves",
      label: "Onslaught",
      icon: wavesIconUrl(),
      value: resources.waves,
      subtext: regenSubtext(resources.wavesNextTokenAt, resources.wavesCapAt),
    },
    { key: "pvp", label: "PVP", icon: pvpIconUrl(), value: resources.pvp, subtext: pvpSubtext },
    {
      key: "guildBoss",
      label: "Guild Raids",
      icon: guildBossIconUrl(),
      value: resources.guildBoss,
      subtext: guildBossSubtext,
    },
    {
      key: "guildBossBomb",
      label: "Guild Raid Bomb",
      icon: guildBossBombIconUrl(),
      value: resources.guildBossBomb,
      subtext: regenSubtext(resources.guildBossBombNextTokenAt, resources.guildBossBombCapAt),
    },
    { key: "mowAmmo", label: "Machines of War Ammo", icon: mowAmmoIconUrl(), value: resources.mowAmmo },
    {
      key: "heroQuest",
      label: "Hero Quest",
      icon: heroQuestIconUrl(),
      value: resources.heroQuestActive ? resources.heroQuest : "-",
      subtext: resources.heroQuestActive
        ? regenSubtext(resources.heroQuestNextTokenAt, resources.heroQuestCapAt)
        : [{ text: "Quest not running", className: DEFAULT_SUBTEXT_CLASS }],
      disabled: !resources.heroQuestActive,
    },
    // Unlike Hero Quest, Survival is omitted entirely (not grayed out) when no seasonal event is
    // currently live - there's nothing useful to show at all in that case.
    ...(resources.survivalActive
      ? [
          {
            key: "survival",
            label: "Survival",
            icon: survivalIconUrl(),
            value: resources.survival,
            subtext: regenSubtext(resources.survivalNextTokenAt, resources.survivalCapAt),
          },
        ]
      : []),
  ];

  const tokensRow = (
    <div className="flex flex-wrap items-start justify-center gap-3">
      {entries.map((entry) => (
        <div
          key={entry.key}
          className={`flex h-36 w-44 flex-col items-center gap-1 rounded-lg border border-black/10 bg-white/60 p-2 text-center dark:border-white/15 dark:bg-white/5 ${
            entry.disabled ? "opacity-40" : ""
          }`}
        >
          <Icon src={entry.icon} title={entry.label} />
          <span className="text-sm font-medium">{entry.value}</span>
          {entry.subtext?.map((line, i) => (
            <span key={i} className={`text-xs ${line.className}`}>
              {line.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop: unchanged, always visible. Mobile: collapsed behind a toggle. */}
      <div className="hidden md:block">{tokensRow}</div>
      <div className="w-full md:hidden">
        <button
          type="button"
          onClick={toggleMobileOpen}
          className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm text-neutral-700 outline-none transition-colors hover:border-blue-500 active:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:active:bg-neutral-900/40"
        >
          {mobileOpen ? "Hide tokens" : "Show tokens"}
        </button>
        {mobileOpen && <div className="pt-2">{tokensRow}</div>}
      </div>
    </>
  );
}

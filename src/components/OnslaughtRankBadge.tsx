import {
  ONSLAUGHT_CHALLENGE_FRAME_URL,
  frameRarityForMetal,
  metalForTier,
  onslaughtFrameUrl,
  onslaughtRankIconUrl,
} from "../onslaught/onslaught-icons";
import { rankToString } from "../rank/rank.enum";
import type { Rank } from "../rank/rank.enum";

interface OnslaughtRankBadgeProps {
  tier: number;
  isChallenge: boolean;
  className?: string;
}

// Layers (see onslaught-icons.ts): the rarity-colored frame (a uniform 150x197 aspect across all
// 6 colors), the extra "challenge" accent frame on top when isChallenge - its own art is taller
// (156x293, confirmed by direct inspection) because it has spikes meant to stick out above/below
// the normal frame rather than get squashed to fit it, so it's scaled to match the base frame's
// WIDTH (104%/149% below are that ratio) instead of independently fit to the same box - and the
// rank icon itself (a numeral I/II/III, or a skull for "4"/challenge) centered on top of both.
// The 60% inner box for the rank icon is a first-pass estimate (icon art varies in size/aspect
// per metal - e.g. the mythic skull has wings and renders wider) and may need visual tuning once
// rendered, same tradeoff as ArenaEquipmentSlot's icon sizing.
export function OnslaughtRankBadge({ tier, isChallenge, className }: OnslaughtRankBadgeProps) {
  const metal = metalForTier(tier);
  const label = rankToString(tier as Rank);
  return (
    <div className={`relative aspect-[150/197] ${className ?? ""}`} title={label}>
      <img
        src={onslaughtFrameUrl(frameRarityForMetal(metal))}
        alt=""
        className="absolute inset-0 h-full w-full object-contain"
      />
      {isChallenge && (
        <img
          src={ONSLAUGHT_CHALLENGE_FRAME_URL}
          alt=""
          className="absolute left-1/2 top-1/2 h-[149%] w-[104%] -translate-x-1/2 -translate-y-1/2 object-contain"
        />
      )}
      <img
        src={onslaughtRankIconUrl(tier, isChallenge)}
        alt={label}
        className="absolute left-1/2 top-1/2 h-[60%] w-[60%] -translate-x-1/2 -translate-y-1/2 object-contain"
      />
    </div>
  );
}

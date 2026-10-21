import { RarityStars } from "./rarity-stars.enum";

interface StarIcon {
  file: string;
  count: number;
}

const STAR_ICON_TABLE: Record<RarityStars, StarIcon | null> = {
  [RarityStars.None]: null,
  [RarityStars.OneStar]: { file: "yellow_star.png", count: 1 },
  [RarityStars.TwoStars]: { file: "yellow_star.png", count: 2 },
  [RarityStars.ThreeStars]: { file: "yellow_star.png", count: 3 },
  [RarityStars.FourStars]: { file: "yellow_star.png", count: 4 },
  [RarityStars.FiveStars]: { file: "yellow_star.png", count: 5 },
  [RarityStars.RedOneStar]: { file: "red_star.png", count: 1 },
  [RarityStars.RedTwoStars]: { file: "red_star.png", count: 2 },
  [RarityStars.RedThreeStars]: { file: "red_star.png", count: 3 },
  [RarityStars.RedFourStars]: { file: "red_star.png", count: 4 },
  [RarityStars.RedFiveStars]: { file: "red_star.png", count: 5 },
  [RarityStars.OneBlueStar]: { file: "blue_star.png", count: 1 },
  [RarityStars.TwoBlueStars]: { file: "blue_star.png", count: 2 },
  [RarityStars.ThreeBlueStars]: { file: "blue_star.png", count: 3 },
  [RarityStars.MythicWings]: { file: "mythic_wings.png", count: 1 },
};

export function starIconUrls(stars: RarityStars): string[] {
  const icon = STAR_ICON_TABLE[stars];
  if (!icon) {
    return [];
  }
  const url = new URL(`../assets/stars/${icon.file}`, import.meta.url).href;
  return Array(icon.count).fill(url);
}

// mythic_wings.png is a wide emblem (512x164), unlike every other star sprite here (roughly
// square) - a caller that renders star icons in a fixed square box (rather than through the
// shared Icon component, which already sizes by height and lets width follow) needs to drop the
// fixed width for this one specifically, or it gets squashed horizontally to fit the square.
export function isMythicWingsIconUrl(url: string): boolean {
  return url.includes("mythic_wings");
}

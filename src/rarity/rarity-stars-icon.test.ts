import { describe, expect, it } from "vitest";
import { isMythicWingsIconUrl, starIconUrls } from "./rarity-stars-icon";
import { RarityStars } from "./rarity-stars.enum";

describe("isMythicWingsIconUrl", () => {
  it("identifies the mythic wings sprite among a real starIconUrls() result", () => {
    const [url] = starIconUrls(RarityStars.MythicWings);
    expect(isMythicWingsIconUrl(url)).toBe(true);
  });

  it("is false for every other star sprite", () => {
    for (const stars of [RarityStars.OneStar, RarityStars.RedThreeStars, RarityStars.TwoBlueStars]) {
      for (const url of starIconUrls(stars)) {
        expect(isMythicWingsIconUrl(url)).toBe(false);
      }
    }
  });
});

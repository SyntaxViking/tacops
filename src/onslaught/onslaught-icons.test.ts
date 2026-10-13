import { describe, expect, it } from "vitest";
import {
  frameRarityForMetal,
  metalForTier,
  onslaughtFrameUrl,
  onslaughtRankIconUrl,
  positionInMetal,
  ONSLAUGHT_CHALLENGE_FRAME_URL,
} from "./onslaught-icons";

describe("metalForTier", () => {
  it("maps each 3-tier group to its metal, including the boundary tiers", () => {
    expect(metalForTier(1)).toBe("stone");
    expect(metalForTier(3)).toBe("stone");
    expect(metalForTier(4)).toBe("iron");
    expect(metalForTier(6)).toBe("iron");
    expect(metalForTier(7)).toBe("bronze");
    expect(metalForTier(9)).toBe("bronze");
    expect(metalForTier(10)).toBe("silver");
    expect(metalForTier(12)).toBe("silver");
    expect(metalForTier(13)).toBe("gold");
    expect(metalForTier(15)).toBe("gold");
    expect(metalForTier(16)).toBe("diamond");
    expect(metalForTier(18)).toBe("diamond");
    expect(metalForTier(19)).toBe("mythic");
    expect(metalForTier(21)).toBe("mythic");
  });
});

describe("positionInMetal", () => {
  it("cycles 1/2/3 within each metal's group regardless of the absolute tier number", () => {
    expect(positionInMetal(1)).toBe(1);
    expect(positionInMetal(2)).toBe(2);
    expect(positionInMetal(3)).toBe(3);
    expect(positionInMetal(19)).toBe(1);
    expect(positionInMetal(20)).toBe(2);
    expect(positionInMetal(21)).toBe(3);
  });
});

describe("frameRarityForMetal", () => {
  it("gives Stone and Iron the same common frame", () => {
    expect(frameRarityForMetal("stone")).toBe("common");
    expect(frameRarityForMetal("iron")).toBe("common");
  });

  it("maps the remaining metals 1:1 to their own rarity color", () => {
    expect(frameRarityForMetal("bronze")).toBe("uncommon");
    expect(frameRarityForMetal("silver")).toBe("rare");
    expect(frameRarityForMetal("gold")).toBe("epic");
    expect(frameRarityForMetal("diamond")).toBe("legendary");
    expect(frameRarityForMetal("mythic")).toBe("mythic");
  });
});

describe("onslaughtRankIconUrl", () => {
  it("resolves to the plain numeral icon for a non-challenge tier", () => {
    expect(onslaughtRankIconUrl(1, false)).toContain("ui_onslaught_button_rank_stone_1.png");
    expect(onslaughtRankIconUrl(2, false)).toContain("ui_onslaught_button_rank_stone_2.png");
    expect(onslaughtRankIconUrl(3, false)).toContain("ui_onslaught_button_rank_stone_3.png");
    expect(onslaughtRankIconUrl(21, false)).toContain("ui_onslaught_button_rank_mythic_3.png");
  });

  it("resolves to the '4' (challenge/skull) variant regardless of the literal tier's own position", () => {
    expect(onslaughtRankIconUrl(3, true)).toContain("ui_onslaught_button_rank_stone_4.png");
    expect(onslaughtRankIconUrl(21, true)).toContain("ui_onslaught_button_rank_mythic_4.png");
  });
});

describe("onslaughtFrameUrl / ONSLAUGHT_CHALLENGE_FRAME_URL", () => {
  it("resolves each rarity to its own frame file", () => {
    expect(onslaughtFrameUrl("common")).toContain("ui_onslaught_button_frame_common.png");
    expect(onslaughtFrameUrl("mythic")).toContain("ui_onslaught_button_frame_mythic.png");
  });

  it("points the challenge overlay at its own distinct frame file", () => {
    expect(ONSLAUGHT_CHALLENGE_FRAME_URL).toContain("ui_onslaught_button_frame_challenge.png");
  });
});

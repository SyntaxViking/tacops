import { describe, expect, it } from "vitest";
import { getReplayPlaylistCharacterSlotRow } from "./replay-playlist-battle-view-model";
import { Rank } from "../rank/rank.enum";
import { Rarity } from "../rarity/rarity.enum";
import { RarityStars } from "../rarity/rarity-stars.enum";
import type { ReplayPlaylistCharacterSlot } from "./replay-playlist-battle-view-model";

function slot(overrides: Partial<ReplayPlaylistCharacterSlot> = {}): ReplayPlaylistCharacterSlot {
  return {
    characterId: "deathRotbone",
    rank: Rank.Gold1,
    rarity: Rarity.Epic,
    stars: RarityStars.RedOneStar,
    abilityLevel1: 65,
    abilityLevel2: 65,
    ...overrides,
  };
}

describe("getReplayPlaylistCharacterSlotRow", () => {
  it("resolves a known character's name and portrait", () => {
    const row = getReplayPlaylistCharacterSlotRow(slot());
    expect(row.name).not.toBe("deathRotbone");
    expect(row.portraitUrl).not.toBe("");
    expect(row.abilityLevel1).toBe(65);
    expect(row.abilityLevel2).toBe(65);
  });

  it("falls back to the raw id and an empty portrait instead of throwing for an unrecognized character id", () => {
    const row = getReplayPlaylistCharacterSlotRow(slot({ characterId: "notARealCharacterId" }));
    expect(row.name).toBe("notARealCharacterId");
    expect(row.portraitUrl).toBe("");
    // Rank/rarity/stars/ability levels come straight from the hand-typed slot, not bundled
    // character data, so they still resolve even when the character id itself doesn't.
    expect(row.rankIconUrl).not.toBe("");
    expect(row.rarityIconUrl).not.toBe("");
  });
});

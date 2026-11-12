import { describe, expect, it } from "vitest";
import { Rarity } from "../rarity/rarity.enum";
import { estimateXpGain, isXpCapped } from "./xp-gain";

describe("estimateXpGain", () => {
  it("earns nothing once the character is at their rarity's XP cap", () => {
    expect(isXpCapped(Rarity.Mythic, 60)).toBe(true);
    expect(estimateXpGain(Rarity.Mythic, Rarity.Mythic, 60, 10_000)).toBe(0);
  });

  it("earns more with higher power", () => {
    expect(estimateXpGain(Rarity.Rare, Rarity.Epic, 10, 8000)).toBeGreaterThan(estimateXpGain(Rarity.Rare, Rarity.Epic, 10, 2000));
  });

  it("earns more from a higher-rarity operation at the same power", () => {
    expect(estimateXpGain(Rarity.Mythic, Rarity.Mythic, 10, 5000)).toBeGreaterThan(estimateXpGain(Rarity.Epic, Rarity.Mythic, 10, 5000));
  });

  it("matches the Mythic-operation fit: about 11.4 * power^0.37", () => {
    expect(estimateXpGain(Rarity.Mythic, Rarity.Mythic, 10, 10_000)).toBeCloseTo(11.4 * 10_000 ** 0.37, 6);
  });

  it("earns nothing when power is unknown", () => {
    expect(estimateXpGain(Rarity.Rare, Rarity.Epic, 10, null)).toBe(0);
  });
});

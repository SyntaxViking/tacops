import { describe, expect, it } from "vitest";
import { getPowerItemInfo, itemFrameTiers } from "./pvp-equipment";

describe("getPowerItemInfo", () => {
  it("resolves a known item id", () => {
    expect(getPowerItemInfo("I_Defensive_M003").name).toBe("Ancient Plated Greaves");
  });

  it("throws on an unknown item id", () => {
    expect(() => getPowerItemInfo("I_NotReal_000")).toThrow();
  });
});

describe("itemFrameTiers", () => {
  it("layers mythic then relic for a relic item, regardless of its own rarity casing", () => {
    expect(itemFrameTiers("Mythic", true)).toEqual(["mythic", "relic"]);
  });

  it("returns a single lowercased tier for a plain mythic item", () => {
    expect(itemFrameTiers("Mythic", undefined)).toEqual(["mythic"]);
  });

  it("returns a single lowercased tier for a common item", () => {
    expect(itemFrameTiers("Common", false)).toEqual(["common"]);
  });
});

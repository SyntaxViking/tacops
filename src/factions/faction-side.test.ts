import { describe, expect, it } from "vitest";
import { FACTION_SIDE, factionSide } from "./faction-side";
import { FACTION_ICON_FILE } from "./faction-icon";

describe("FACTION_SIDE", () => {
  it("covers every faction faction-icon.ts knows about", () => {
    for (const factionId of Object.keys(FACTION_ICON_FILE)) {
      expect(FACTION_SIDE[factionId], `missing FACTION_SIDE entry for ${factionId}`).toBeDefined();
    }
  });

  it("puts Imperium factions on the for side", () => {
    expect(factionSide("Ultramarines")).toBe("for");
    expect(factionSide("Custodes")).toBe("for");
  });

  it("puts Chaos and Xenos factions on the against side", () => {
    expect(factionSide("BlackLegion")).toBe("against");
    expect(factionSide("Necrons")).toBe("against");
  });

  it("returns undefined for an unknown faction id", () => {
    expect(factionSide("NotARealFaction")).toBeUndefined();
  });
});

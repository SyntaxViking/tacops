import { describe, expect, it } from "vitest";
import { sortCharacterRows } from "./character-view-model";
import type { CharacterRow } from "./character-view-model";

function row(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: "unit_001",
    name: "Test Unit",
    portraitUrl: "",
    faction: "",
    rarityIconUrl: "",
    starIconUrls: [],
    rankIconUrl: "",
    damageProfileIconUrls: [],
    traitIconUrls: [],
    ...overrides,
  };
}

describe("sortCharacterRows", () => {
  it("powerDesc sorts descending by power, undefined power sorting last", () => {
    const rows = [row({ id: "low", power: 10 }), row({ id: "unknown" }), row({ id: "high", power: 100 })];
    expect(sortCharacterRows(rows, "powerDesc").map((r) => r.id)).toEqual(["high", "low", "unknown"]);
  });

  it("nameAsc sorts ascending by displayed name", () => {
    const rows = [row({ id: "b", name: "Beta" }), row({ id: "a", name: "Alpha" })];
    expect(sortCharacterRows(rows, "nameAsc").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("factionThenName sorts by faction first, then name within a faction", () => {
    const rows = [
      row({ id: "z-in-a", name: "Zeta", faction: "AFaction" }),
      row({ id: "a-in-b", name: "Alpha", faction: "BFaction" }),
      row({ id: "a-in-a", name: "Alpha", faction: "AFaction" }),
    ];
    expect(sortCharacterRows(rows, "factionThenName").map((r) => r.id)).toEqual(["a-in-a", "z-in-a", "a-in-b"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ id: "b", power: 1 }), row({ id: "a", power: 2 })];
    sortCharacterRows(rows, "powerDesc");
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

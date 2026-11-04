import { describe, expect, it } from "vitest";
import { characterPortraitUrl, hasCharacterPortrait } from "./character-portraits";

describe("hasCharacterPortrait", () => {
  it("is true for a known character id", () => {
    expect(hasCharacterPortrait("deathRotbone")).toBe(true);
  });

  it("is false for an unrecognized character id, letting a caller skip it instead of calling the throwing characterPortraitUrl", () => {
    expect(hasCharacterPortrait("notARealCharacterId")).toBe(false);
  });

  it("agrees with characterPortraitUrl's own throw behavior", () => {
    expect(() => characterPortraitUrl("notARealCharacterId")).toThrow();
  });
});

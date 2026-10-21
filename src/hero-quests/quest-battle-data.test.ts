import { describe, expect, it } from "vitest";
import { activeQuestBattles } from "./quest-battle-data";

describe("activeQuestBattles", () => {
  it("returns the bundled battles for a live quest we have data for", () => {
    const battles = activeQuestBattles(["linear_hero_event_4"]);
    expect(battles).not.toBeNull();
    expect(battles!.length).toBeGreaterThan(0);
    // Descending by battle number, same order the quest tab should show them in.
    for (let i = 1; i < battles!.length; i++) {
      expect(battles![i].battleNumber).toBeLessThanOrEqual(battles![i - 1].battleNumber);
    }
  });

  it("returns null for a live quest we have no bundled data for", () => {
    expect(activeQuestBattles(["linear_hero_event_999"])).toBeNull();
  });

  it("returns null when nothing is live", () => {
    expect(activeQuestBattles([])).toBeNull();
  });

  it("picks the first match among several active ids", () => {
    expect(activeQuestBattles(["linear_hero_event_999", "linear_hero_event_4"])).not.toBeNull();
  });
});

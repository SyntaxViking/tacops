import { describe, expect, it } from "vitest";
import { extractActiveQuestIds } from "./active-quest-extraction";

function linearHeroEventLiveEvent(liveEventConfigId: string) {
  return { modules: [{ type: "linearHeroEvent", module: { liveEventConfigId } }] };
}

describe("extractActiveQuestIds", () => {
  it("collects every linearHeroEvent module's liveEventConfigId", () => {
    const hero = { liveEvents: { liveEvents: [linearHeroEventLiveEvent("linear_hero_event_4")] } };
    expect(extractActiveQuestIds(hero)).toEqual(["linear_hero_event_4"]);
  });

  it("ignores liveEvents without a linearHeroEvent module", () => {
    const hero = {
      liveEvents: {
        liveEvents: [{ modules: [{ type: "crusadeEvent", module: {} }] }, linearHeroEventLiveEvent("linear_hero_event_4")],
      },
    };
    expect(extractActiveQuestIds(hero)).toEqual(["linear_hero_event_4"]);
  });

  it("returns every id when more than one quest is live at once", () => {
    const hero = {
      liveEvents: { liveEvents: [linearHeroEventLiveEvent("linear_hero_event_4"), linearHeroEventLiveEvent("linear_hero_event_2")] },
    };
    expect(extractActiveQuestIds(hero)).toEqual(["linear_hero_event_4", "linear_hero_event_2"]);
  });

  it("returns an empty list when hero/liveEvents is missing entirely", () => {
    expect(extractActiveQuestIds({})).toEqual([]);
    expect(extractActiveQuestIds(undefined)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { activeCrusadeEventLiveEvent, extractSectorMap } from "./sector-map-extraction";

const now = Date.now();

function crusadeEventLiveEvent(id: string, startsOn: number, endsOn: number, planetId = `planet_${id}`) {
  return {
    liveEventId: id,
    startsOn,
    endsOn,
    modules: [
      {
        type: "crusadeEvent",
        module: {
          planetsConfig: {
            planets: [{ planetId, zone: "zone1", type: "Fortress", positionX: 1, positionY: 2 }],
            connections: [],
          },
        },
      },
    ],
  };
}

describe("activeCrusadeEventLiveEvent", () => {
  it("picks the crusadeEvent liveEvent whose own startsOn/endsOn brackets now", () => {
    const past = crusadeEventLiveEvent("past", now - 10_000, now - 1_000);
    const current = crusadeEventLiveEvent("current", now - 1_000, now + 10_000);
    const future = crusadeEventLiveEvent("future", now + 10_000, now + 20_000);
    expect(activeCrusadeEventLiveEvent([past, current, future]).liveEventId).toBe("current");
  });

  it("doesn't just pick whichever comes first in the array - order-independent", () => {
    const current = crusadeEventLiveEvent("current", now - 1_000, now + 10_000);
    const future = crusadeEventLiveEvent("future", now + 10_000, now + 20_000);
    // "future" listed first - the old `.find()`-first-match behavior would have wrongly picked it.
    expect(activeCrusadeEventLiveEvent([future, current]).liveEventId).toBe("current");
  });

  it("ignores liveEvents without a crusadeEvent module entirely", () => {
    const offerEvent = { liveEventId: "offer", startsOn: now - 1_000, endsOn: now + 1_000, modules: [{ type: "offerProduct", module: {} }] };
    const current = crusadeEventLiveEvent("current", now - 1_000, now + 10_000);
    expect(activeCrusadeEventLiveEvent([offerEvent, current]).liveEventId).toBe("current");
  });

  it("falls back to the first crusadeEvent found when none brackets now", () => {
    const past = crusadeEventLiveEvent("past", now - 10_000, now - 1_000);
    const alsoPast = crusadeEventLiveEvent("also-past", now - 20_000, now - 15_000);
    expect(activeCrusadeEventLiveEvent([past, alsoPast]).liveEventId).toBe("past");
  });

  it("returns undefined for an empty list", () => {
    expect(activeCrusadeEventLiveEvent([])).toBeUndefined();
  });
});

describe("extractSectorMap", () => {
  it("extracts planets/connections from the currently-active crusadeEvent module, not an overlapping past/future one", () => {
    const past = crusadeEventLiveEvent("past", now - 10_000, now - 1_000, "planet_old");
    const current = crusadeEventLiveEvent("current", now - 1_000, now + 10_000, "planet_new");
    const hero = { liveEvents: { liveEvents: [past, current] } };
    const result = extractSectorMap(hero);
    expect(result.planets.map((p) => p.planetId)).toEqual(["planet_new"]);
  });

  it("returns an empty map when there's nothing to extract", () => {
    expect(extractSectorMap({})).toEqual({ planets: [], connections: [] });
    expect(extractSectorMap(undefined)).toEqual({ planets: [], connections: [] });
  });
});

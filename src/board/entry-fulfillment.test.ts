import { describe, expect, it } from "vitest";
import { getEntryFulfillment } from "./entry-fulfillment";
import type { ExpeditionBoardEntry, RawUnit } from "../api/types";

function dispatchedEntry(units: string[]): ExpeditionBoardEntry {
  return {
    expeditionId: "exp",
    id: "op",
    category: "all_vanguard",
    rarity: "Common",
    participants: 1,
    duration: 3600,
    bonusObjectives: [{ objectiveType: "DamageType", objectiveTarget: "Toxic" }],
    baseRewards: [],
    bonusRewards: [],
    status: "Dispatched",
    startedOn: 1,
    units,
  };
}

describe("getEntryFulfillment for a dispatched board", () => {
  it("counts a sent unit's relic-added damage profile toward the bonus objective", () => {
    const heroes: RawUnit[] = [{ id: "deathRotbone", extraDamageProfiles: ["Toxic"] }];
    expect(getEntryFulfillment(dispatchedEntry(["deathRotbone"]), new Map(), heroes)).toBe("complete");
  });

  it("is only partial when the sent unit has no relic adding the required profile", () => {
    const heroes: RawUnit[] = [{ id: "deathRotbone" }];
    expect(getEntryFulfillment(dispatchedEntry(["deathRotbone"]), new Map(), heroes)).toBe("partial");
  });

  it("is only partial when the sent unit isn't in the heroes list at all", () => {
    expect(getEntryFulfillment(dispatchedEntry(["deathRotbone"]), new Map(), [])).toBe("partial");
  });
});

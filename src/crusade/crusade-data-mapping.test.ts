import { describe, expect, it } from "vitest";
import { findActivePhase, resolveMyFactionId } from "./crusade-data-mapping";

describe("resolveMyFactionId", () => {
  it("returns forFactionId when chosenSide is For", () => {
    expect(resolveMyFactionId({ chosenSide: "For", forFactionId: "Custodes", againstFactionId: "WorldEaters" })).toBe("Custodes");
  });

  it("returns againstFactionId when chosenSide is Against", () => {
    expect(resolveMyFactionId({ chosenSide: "Against", forFactionId: "Custodes", againstFactionId: "WorldEaters" })).toBe("WorldEaters");
  });

  it("matches chosenSide case-insensitively", () => {
    expect(resolveMyFactionId({ chosenSide: "against", forFactionId: "Custodes", againstFactionId: "WorldEaters" })).toBe("WorldEaters");
  });
});

describe("findActivePhase", () => {
  it("resolves whichever phase actually brackets now, not just the first CRUSADE entry", () => {
    const realNow = Date.now();
    const phasesAroundNow = [{ phase: "CRUSADE", zone: "zone5", startsOn: realNow - 1000, endsOn: realNow + 1000 }];
    expect(findActivePhase(undefined, phasesAroundNow, undefined)).toEqual({ phase: "CRUSADE", activeZone: 4 });
  });

  it("returns STRUGGLE with a null activeZone (Domination has no zone)", () => {
    const realNow = Date.now();
    const struggleAroundNow = { phase: "STRUGGLE", startsOn: realNow - 1000, endsOn: realNow + 1000 };
    expect(findActivePhase(undefined, [], struggleAroundNow)).toEqual({ phase: "STRUGGLE", activeZone: null });
  });

  it("returns DOWNTIME with a null activeZone", () => {
    const realNow = Date.now();
    const downtimeAroundNow = { phase: "DOWNTIME", startsOn: realNow - 1000, endsOn: realNow + 1000 };
    expect(findActivePhase(downtimeAroundNow, [], undefined)).toEqual({ phase: "DOWNTIME", activeZone: null });
  });

  it("returns null phase when nothing brackets now (all inputs undefined/empty)", () => {
    expect(findActivePhase(undefined, [], undefined)).toEqual({ phase: null, activeZone: null });
  });
});

import { describe, expect, it } from "vitest";
import { MAX_STARRED_PLANETS, capStarredPlanets, isStarDisabled, toggleStarredPlanet } from "./starred-planets";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `planet_${i + 1}`);

describe("capStarredPlanets", () => {
  it("leaves a list within the cap untouched", () => {
    expect(capStarredPlanets(ids(10))).toEqual(ids(10));
    expect(capStarredPlanets([])).toEqual([]);
  });

  it("silently keeps only the first ten, in stored order", () => {
    expect(capStarredPlanets(ids(15))).toEqual(ids(10));
  });
});

describe("toggleStarredPlanet", () => {
  it("stars a planet under the cap", () => {
    expect([...toggleStarredPlanet(new Set(ids(3)), "planet_99")]).toEqual([...ids(3), "planet_99"]);
  });

  it("un-stars an already-starred planet", () => {
    expect([...toggleStarredPlanet(new Set(ids(3)), "planet_2")]).toEqual(["planet_1", "planet_3"]);
  });

  it("silently ignores starring an eleventh planet, returning the same Set so callers can tell nothing changed", () => {
    const full = new Set(ids(MAX_STARRED_PLANETS));
    expect(toggleStarredPlanet(full, "planet_99")).toBe(full);
  });

  it("still allows un-starring when at the cap", () => {
    const full = new Set(ids(MAX_STARRED_PLANETS));
    const next = toggleStarredPlanet(full, "planet_1");
    expect(next.size).toBe(MAX_STARRED_PLANETS - 1);
    expect(next.has("planet_1")).toBe(false);
  });

  it("does not mutate its input", () => {
    const original = new Set(ids(2));
    toggleStarredPlanet(original, "planet_99");
    expect([...original]).toEqual(ids(2));
  });
});

describe("isStarDisabled", () => {
  it("is false for any planet while under the cap", () => {
    const nine = new Set(ids(MAX_STARRED_PLANETS - 1));
    expect(isStarDisabled(nine, "planet_99")).toBe(false);
    expect(isStarDisabled(nine, "planet_1")).toBe(false);
  });

  it("is true for an unstarred planet once the cap is reached", () => {
    expect(isStarDisabled(new Set(ids(MAX_STARRED_PLANETS)), "planet_99")).toBe(true);
  });

  it("stays false for an already-starred planet at the cap, so it can be un-starred", () => {
    expect(isStarDisabled(new Set(ids(MAX_STARRED_PLANETS)), "planet_1")).toBe(false);
  });

  it("re-enables starring as soon as one is un-starred", () => {
    const full = new Set(ids(MAX_STARRED_PLANETS));
    expect(isStarDisabled(full, "planet_99")).toBe(true);
    expect(isStarDisabled(toggleStarredPlanet(full, "planet_1"), "planet_99")).toBe(false);
  });
});

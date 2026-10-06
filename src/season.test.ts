import { describe, expect, it } from "vitest";
import { resolveActiveSeason, type SeasonScheduleEntry } from "./season";

describe("resolveActiveSeason", () => {
  const schedule: SeasonScheduleEntry[] = [
    { season: "1.41", endsAt: 1000 },
    { season: "1.43", endsAt: null },
  ];

  it("stays on the current season before its endsAt", () => {
    expect(resolveActiveSeason(schedule, 999)).toBe("1.41");
  });

  it("switches to the next season at exactly endsAt (exclusive upper bound on the old one)", () => {
    expect(resolveActiveSeason(schedule, 1000)).toBe("1.43");
  });

  it("stays on the next season well past endsAt", () => {
    expect(resolveActiveSeason(schedule, 999_999)).toBe("1.43");
  });

  it("stays on a season indefinitely while its endsAt is null", () => {
    const openEnded: SeasonScheduleEntry[] = [{ season: "1.41", endsAt: null }];
    expect(resolveActiveSeason(openEnded, 0)).toBe("1.41");
    expect(resolveActiveSeason(openEnded, Number.MAX_SAFE_INTEGER)).toBe("1.41");
  });

  it("falls back to the last entry if every entry's endsAt has already passed", () => {
    const allPassed: SeasonScheduleEntry[] = [
      { season: "1.41", endsAt: 1000 },
      { season: "1.43", endsAt: 2000 },
    ];
    expect(resolveActiveSeason(allPassed, 5000)).toBe("1.43");
  });
});

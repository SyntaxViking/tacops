import { describe, expect, it } from "vitest";
import { formatStaleness } from "./format-date-time";

describe("formatStaleness", () => {
  it("formats zero elapsed as 00:00", () => {
    expect(formatStaleness(0)).toBe("00:00");
  });

  it("stays in mm:ss just under a minute", () => {
    expect(formatStaleness(59_000)).toBe("00:59");
  });

  it("rolls over to 01:00 at exactly a minute", () => {
    expect(formatStaleness(60_000)).toBe("01:00");
  });

  it("stays in mm:ss just under an hour", () => {
    expect(formatStaleness(3_599_000)).toBe("59:59");
  });

  it("gains an unpadded hour prefix at exactly an hour", () => {
    expect(formatStaleness(3_600_000)).toBe("1:00:00");
  });

  it("formats hours, minutes, and seconds together past an hour", () => {
    expect(formatStaleness(3_661_000)).toBe("1:01:01");
  });

  it("floors partial seconds rather than rounding", () => {
    expect(formatStaleness(1_999)).toBe("00:01");
  });

  it("treats negative elapsed as zero rather than going negative", () => {
    expect(formatStaleness(-500)).toBe("00:00");
  });
});

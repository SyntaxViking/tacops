import { describe, expect, it } from "vitest";
import { isInRolloverWindow, msUntilRolloverWindowEnds } from "./rollover-window";

// All timestamps below are epoch ms for 2026-01-01 (an arbitrary day with no leap-second/DST
// weirdness) at the given UTC time, so the "ms of day" math is easy to verify by hand.
function utc(hours: number, minutes: number, seconds: number, ms = 0): number {
  return Date.UTC(2026, 0, 1, hours, minutes, seconds, ms);
}

describe("isInRolloverWindow", () => {
  it("is true at the exact start of the window (23:30:00.000)", () => {
    expect(isInRolloverWindow(utc(23, 30, 0))).toBe(true);
  });

  it("is false one millisecond before the window starts", () => {
    expect(isInRolloverWindow(utc(23, 29, 59, 999))).toBe(false);
  });

  it("is true one millisecond after the window starts", () => {
    expect(isInRolloverWindow(utc(23, 30, 0, 1))).toBe(true);
  });

  it("is true at midnight, in the middle of the window", () => {
    expect(isInRolloverWindow(utc(0, 0, 0))).toBe(true);
  });

  it("is true one millisecond before the window ends (00:29:59.999)", () => {
    expect(isInRolloverWindow(utc(0, 29, 59, 999))).toBe(true);
  });

  it("is false at the exact end of the window (00:30:00.000) - end is exclusive", () => {
    expect(isInRolloverWindow(utc(0, 30, 0))).toBe(false);
  });

  it("is false far from the window", () => {
    expect(isInRolloverWindow(utc(12, 0, 0))).toBe(false);
  });
});

describe("msUntilRolloverWindowEnds", () => {
  it("returns the full 60 minutes right at the start of the window", () => {
    expect(msUntilRolloverWindowEnds(utc(23, 30, 0))).toBe(60 * 60 * 1000);
  });

  it("returns 30 minutes at midnight", () => {
    expect(msUntilRolloverWindowEnds(utc(0, 0, 0))).toBe(30 * 60 * 1000);
  });

  it("returns 1ms just before the window ends", () => {
    expect(msUntilRolloverWindowEnds(utc(0, 29, 59, 999))).toBe(1);
  });

  it("returns 0 exactly at the window's end", () => {
    expect(msUntilRolloverWindowEnds(utc(0, 30, 0))).toBe(0);
  });

  it("returns 0 far from the window", () => {
    expect(msUntilRolloverWindowEnds(utc(12, 0, 0))).toBe(0);
  });
});

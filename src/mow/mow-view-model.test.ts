import { describe, expect, it } from "vitest";
import { getSafeMowRow } from "./mow-view-model";
import type { RawUnit } from "../api/types";

describe("getSafeMowRow", () => {
  it("resolves a known machine of war", () => {
    const mow: RawUnit = { id: "tyranBiovore" };
    expect(getSafeMowRow(mow, "test")?.id).toBe("tyranBiovore");
  });

  it("returns null instead of throwing for an unrecognized machine of war id", () => {
    const mow: RawUnit = { id: "notARealMowId" };
    expect(getSafeMowRow(mow, "test")).toBeNull();
  });
});

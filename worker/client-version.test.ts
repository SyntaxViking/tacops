import { describe, expect, it } from "vitest";
import { API_VERSION } from "../src/api-version";
import { isClientVersionAcceptable } from "./client-version";

describe("isClientVersionAcceptable", () => {
  it("rejects a missing apiVersion (predates this feature, so never sends the field at all)", () => {
    expect(isClientVersionAcceptable(undefined)).toBe(false);
  });

  it("rejects a non-number value", () => {
    expect(isClientVersionAcceptable("not-a-number")).toBe(false);
    expect(isClientVersionAcceptable(null)).toBe(false);
  });

  it("accepts a client at the current API_VERSION", () => {
    expect(isClientVersionAcceptable(API_VERSION)).toBe(true);
  });

  it("accepts a client ahead of the current API_VERSION (shouldn't normally happen, but never reject a newer client)", () => {
    expect(isClientVersionAcceptable(API_VERSION + 1)).toBe(true);
  });

  it("rejects a client behind the current API_VERSION", () => {
    expect(isClientVersionAcceptable(API_VERSION - 1)).toBe(false);
  });
});

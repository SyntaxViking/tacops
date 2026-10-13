import { describe, expect, it } from "vitest";
import { avatarFrameUrl, avatarUrl } from "./avatar";

describe("avatarUrl", () => {
  it("resolves a known avatar id", () => {
    expect(avatarUrl("adept_cherub_01")).not.toBeNull();
  });

  it("returns null (not throw) for an unknown avatar id", () => {
    expect(avatarUrl("not_a_real_avatar_id")).toBeNull();
  });
});

describe("avatarFrameUrl", () => {
  it("resolves a known frame id", () => {
    expect(avatarFrameUrl("frameHalloween2025")).not.toBeNull();
  });

  it("returns null for a frame id with no resolvable sprite - the real capture's own example", () => {
    // Confirmed unresolvable as of this export (see src/assets/avatar-frames/index.json) - a
    // stand-in for whatever the next still-unresolved season's frame id turns out to be.
    expect(avatarFrameUrl("frameAnniversary2025")).toBeNull();
  });

  it("returns null for an undefined/missing frame id", () => {
    expect(avatarFrameUrl(undefined)).toBeNull();
    expect(avatarFrameUrl(null)).toBeNull();
  });
});

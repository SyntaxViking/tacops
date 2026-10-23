import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWebCredential, retrieveWebCredential, storeWebCredential } from "./store-web-credential";

// This repo has no DOM/jsdom environment (plain Node is vitest's default here, and nothing else
// in the repo needs one) - but unlike the native Credential Management API this file used to
// wrap, Web Crypto (crypto.subtle) and TextEncoder/TextDecoder are plain Node globals, so the only
// thing that needs a shim at all is localStorage's trivial getItem/setItem/removeItem interface.
function installLocalStorageShim() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
}

beforeEach(() => {
  installLocalStorageShim();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storeWebCredential / retrieveWebCredential", () => {
  it("round-trips a stored credential", async () => {
    await storeWebCredential("some-user-id", "some-client-secret");
    const result = await retrieveWebCredential();
    expect(result).toEqual({ userId: "some-user-id", clientSecret: "some-client-secret" });
  });

  it("returns null when nothing is stored", async () => {
    expect(await retrieveWebCredential()).toBeNull();
  });

  it("never stores the credential in plain text", async () => {
    await storeWebCredential("some-user-id", "some-client-secret");
    const raw = localStorage.getItem("tacops.webCredential");
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("some-user-id");
    expect(raw).not.toContain("some-client-secret");
  });

  it("clearWebCredential removes the stored entry", async () => {
    await storeWebCredential("some-user-id", "some-client-secret");
    clearWebCredential();
    expect(await retrieveWebCredential()).toBeNull();
  });

  it("returns null (and clears the entry) for a corrupted stored payload", async () => {
    localStorage.setItem("tacops.webCredential", "not valid json at all");
    expect(await retrieveWebCredential()).toBeNull();
    expect(localStorage.getItem("tacops.webCredential")).toBeNull();
  });

  it("returns null (and clears the entry) when the ciphertext has been tampered with", async () => {
    await storeWebCredential("some-user-id", "some-client-secret");
    const raw = JSON.parse(localStorage.getItem("tacops.webCredential")!);
    raw.data[0] = (raw.data[0] + 1) % 256; // flip a byte - AES-GCM must reject this as unauthenticated
    localStorage.setItem("tacops.webCredential", JSON.stringify(raw));
    expect(await retrieveWebCredential()).toBeNull();
    expect(localStorage.getItem("tacops.webCredential")).toBeNull();
  });
});

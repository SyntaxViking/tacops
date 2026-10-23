// Persists userId/clientSecret in localStorage, encrypted via the Web Crypto API (AES-GCM, a
// real, audited cipher - not a hand-rolled one) using a fixed key baked into this bundle.
//
// This is explicitly NOT real security: the key is exactly as readable by anyone who views this
// file's own (public, client-side) source as the ciphertext is by anyone who opens DevTools, so
// it can't stop a determined attacker or any XSS that can run JS on this page - encryption with a
// key the same JS context can always reach is "locks keep honest people honest," not a security
// boundary. What it DOES raise the bar against: someone glancing at localStorage's raw values in
// DevTools' Application panel, or a non-JS-executing scraper/extension that greps storage for
// recognizable plaintext secrets. Still strictly better than storing the same values in plain
// text, which is why this exists at all.
//
// Replaces an earlier attempt that used the browser's native Credential Management API
// (navigator.credentials.store/get) - abandoned after repeated real-world failures retrieving a
// stored credential that couldn't be diagnosed further without live browser access. This
// approach has no mediation/consent mystery to fail silently, and works in every modern browser
// (Web Crypto + localStorage are universal), not just Chrome/Edge.
const STORAGE_KEY = "tacops.webCredential";

// AES-GCM, 256-bit, fixed - deliberately NOT derived from anything secret, since there is no
// secret available client-side without user interaction (which would defeat "automatic"). The
// specific bytes are arbitrary; any fixed 32-byte value works identically.
const RAW_KEY_BYTES = new Uint8Array([
  0x4a, 0x2f, 0x1e, 0x9c, 0x73, 0xd8, 0x5b, 0x01, 0x6e, 0xaf, 0x33, 0x90, 0xc4, 0x27, 0xb5, 0x8d, 0x11, 0x5f, 0xe6, 0x7a, 0x42, 0x0c, 0x99, 0x3b, 0x8e,
  0x21, 0xd4, 0x56, 0xf0, 0x89, 0x1d, 0x62,
]);

function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", RAW_KEY_BYTES, "AES-GCM", false, ["encrypt", "decrypt"]);
}

interface StoredPayload {
  iv: number[];
  data: number[];
}

export async function storeWebCredential(userId: string, clientSecret: string): Promise<void> {
  try {
    const key = await getKey();
    // A fresh random IV per encryption is standard AES-GCM practice - it doesn't need to be
    // secret, just unique per encryption, so storing it alongside the ciphertext is fine.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify({ userId, clientSecret }));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const payload: StoredPayload = { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    console.log("[storeWebCredential] saved to localStorage");
  } catch (error) {
    console.warn("[storeWebCredential] failed to save", error);
  }
}

export async function retrieveWebCredential(): Promise<{ userId: string; clientSecret: string } | null> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[retrieveWebCredential] localStorage unavailable", error);
    return null;
  }
  if (!raw) {
    console.log("[retrieveWebCredential] nothing stored");
    return null;
  }
  try {
    const { iv, data } = JSON.parse(raw) as StoredPayload;
    const key = await getKey();
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, new Uint8Array(data));
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (typeof parsed?.userId !== "string" || typeof parsed?.clientSecret !== "string") {
      console.warn("[retrieveWebCredential] stored payload decrypted but had the wrong shape - clearing it", parsed);
      clearWebCredential();
      return null;
    }
    console.log("[retrieveWebCredential] found a stored credential, auto-login will be attempted");
    return { userId: parsed.userId, clientSecret: parsed.clientSecret };
  } catch (error) {
    // Most likely cause: the fixed key above changed since this was stored (e.g. a future code
    // change) - clear the now-undecryptable entry rather than leaving a permanent dead entry that
    // fails the same way on every future page load.
    console.warn("[retrieveWebCredential] failed to decrypt stored credential - clearing it", error);
    clearWebCredential();
    return null;
  }
}

export function clearWebCredential(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[clearWebCredential] failed", error);
  }
}

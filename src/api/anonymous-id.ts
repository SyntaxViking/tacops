const STORAGE_KEY = "tacops:anonymousId";

// Stable per-browser identity for an anonymous (not-logged-in) visitor, used only for DAU/WAU/MAU
// tracking (see trackAnonymousUsage in ../track-usage.ts) - never sent anywhere but the SHA-256
// hash of it, same privacy posture as the logged-in trackUsage path. Deliberately not an IP hash:
// IPs are shared across NATs/mobile carriers and rotate, both of which would skew DAU/WAU/MAU.
export function getOrCreateAnonymousId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

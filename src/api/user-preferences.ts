import { sha256Hex } from "./sha256";

export interface UserPreferences {
  favoritedCharacters: string[];
  favoritedPlanets: string[];
  antiFavoritedCharacters: string[];
}

export async function fetchUserPreferences(userId: string): Promise<UserPreferences> {
  const userHash = await sha256Hex(userId);
  const response = await fetch("/api/preferences/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userHash }),
  });
  if (!response.ok) throw new Error(`fetchUserPreferences failed: ${response.status}`);
  return (await response.json()) as UserPreferences;
}

// Only the SHA-256 of userId and clientSecret ever leave the browser here, matching
// track-usage.ts's privacy posture - the backend never sees raw credentials.
async function setFavoritedIds(path: string, userId: string, clientSecret: string, ids: string[]): Promise<void> {
  const [userHash, secretHash] = await Promise.all([sha256Hex(userId), sha256Hex(clientSecret)]);
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userHash, secretHash, ids }),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
}

export function setFavoritedCharacters(userId: string, clientSecret: string, ids: string[]): Promise<void> {
  return setFavoritedIds("/api/preferences/favorited-characters", userId, clientSecret, ids);
}

export function setFavoritedPlanets(userId: string, clientSecret: string, ids: string[]): Promise<void> {
  return setFavoritedIds("/api/preferences/favorited-planets", userId, clientSecret, ids);
}

export function setAntiFavoritedCharacters(userId: string, clientSecret: string, ids: string[]): Promise<void> {
  return setFavoritedIds("/api/preferences/anti-favorited-characters", userId, clientSecret, ids);
}

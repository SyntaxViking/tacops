// One row per user_hash (SHA-256 of userId), gated by secret_hash (SHA-256 of clientSecret) - see
// migrations/0002_create_user_preferences_table.sql. Adding a new favorited-* preference is just:
// add it to PREFERENCE_COLUMNS, add a migration for the column (DEFAULT '[]'), add a route in
// worker/index.ts that calls setUserPreferenceColumn with the new column name.
const PREFERENCE_COLUMNS = ["favorited_characters", "favorited_planets", "anti_favorited_characters"] as const;
export type PreferenceColumn = (typeof PREFERENCE_COLUMNS)[number];

export interface UserPreferences {
  favoritedCharacters: string[];
  favoritedPlanets: string[];
  antiFavoritedCharacters: string[];
}

type PreferenceRow = Record<PreferenceColumn, string>;

export async function getUserPreferences(db: D1Database, userHash: string): Promise<UserPreferences> {
  const row = await db
    .prepare(`SELECT ${PREFERENCE_COLUMNS.join(", ")} FROM user_preferences WHERE user_hash = ?`)
    .bind(userHash)
    .first<PreferenceRow>();
  return {
    favoritedCharacters: row ? (JSON.parse(row.favorited_characters) as string[]) : [],
    favoritedPlanets: row ? (JSON.parse(row.favorited_planets) as string[]) : [],
    antiFavoritedCharacters: row ? (JSON.parse(row.anti_favorited_characters) as string[]) : [],
  };
}

// Blows away and replaces one column's contents. Creates the row (establishing secret_hash for
// this user_hash going forward) if it doesn't exist yet; rejects the write if it exists under a
// different secret_hash - a mismatched password should never be able to overwrite someone else's
// preferences, even though user_hash alone isn't a strong secret.
export async function setUserPreferenceColumn(
  db: D1Database,
  userHash: string,
  secretHash: string,
  column: PreferenceColumn,
  ids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await db.prepare("SELECT secret_hash FROM user_preferences WHERE user_hash = ?").bind(userHash).first<{ secret_hash: string }>();
  if (existing && existing.secret_hash !== secretHash) {
    return { ok: false, error: "Secret does not match existing record" };
  }

  const json = JSON.stringify(ids);
  if (!existing) {
    const otherColumns = PREFERENCE_COLUMNS.filter((c) => c !== column);
    await db
      .prepare(
        `INSERT INTO user_preferences (user_hash, secret_hash, ${column}, ${otherColumns.join(", ")}) ` +
          `VALUES (?, ?, ?, ${otherColumns.map(() => "'[]'").join(", ")})`,
      )
      .bind(userHash, secretHash, json)
      .run();
  } else {
    await db.prepare(`UPDATE user_preferences SET ${column} = ? WHERE user_hash = ?`).bind(json, userHash).run();
  }
  return { ok: true };
}

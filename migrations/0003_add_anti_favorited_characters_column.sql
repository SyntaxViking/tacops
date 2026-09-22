-- Migration number: 0003 	 2026-09-22T07:37:17.000Z

ALTER TABLE user_preferences ADD COLUMN anti_favorited_characters TEXT NOT NULL DEFAULT '[]';

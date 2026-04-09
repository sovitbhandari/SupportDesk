ALTER TABLE users
ADD COLUMN IF NOT EXISTS preferred_name TEXT,
ADD COLUMN IF NOT EXISTS preferred_theme TEXT NOT NULL DEFAULT 'system';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_preferred_theme_check'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_preferred_theme_check
    CHECK (preferred_theme IN ('light', 'dark', 'system'));
  END IF;
END $$;

UPDATE users
SET preferred_name = COALESCE(preferred_name, full_name);

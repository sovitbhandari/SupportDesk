UPDATE users
SET preferred_theme = 'light'
WHERE preferred_theme IS NULL OR preferred_theme = 'system';

ALTER TABLE users
ALTER COLUMN preferred_theme SET DEFAULT 'light';

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_preferred_theme_check;

ALTER TABLE users
ADD CONSTRAINT users_preferred_theme_check
CHECK (preferred_theme IN ('light', 'dark'));

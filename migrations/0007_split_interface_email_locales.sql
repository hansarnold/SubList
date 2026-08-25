-- Phase 5 separates the browser interface locale from reminder-email rendering.
-- Keep preferred_locale as the interface-locale storage column for an additive,
-- rollback-safe migration and copy its current value into the new email locale.

ALTER TABLE users
  ADD COLUMN email_locale TEXT NOT NULL DEFAULT 'en'
  CHECK (email_locale IN ('en', 'zh-Hans'));

UPDATE users SET email_locale = preferred_locale;

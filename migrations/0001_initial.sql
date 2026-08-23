CREATE TABLE users (
  id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  default_currency TEXT NOT NULL DEFAULT 'USD',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 64),
  CHECK (length(trim(primary_email)) > 3),
  CHECK (
    length(default_currency) = 3
    AND default_currency = upper(default_currency)
  )
) STRICT;

CREATE TABLE auth_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (provider IN ('cloudflare_access', 'local_development')),
  CHECK (length(subject) BETWEEN 1 AND 512)
) STRICT;

CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
CREATE INDEX idx_auth_identities_email
  ON auth_identities(provider, email_normalized);

CREATE TABLE categories (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (length(name_key) BETWEEN 1 AND 160),
  CHECK (length(color) = 7 AND substr(color, 1, 1) = '#'),
  CHECK (position >= 0)
) STRICT;

CREATE UNIQUE INDEX ux_categories_user_name_key
  ON categories(user_id, name_key);

CREATE TABLE payment_methods (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  label TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (kind IN ('card', 'wallet', 'bank', 'store', 'other')),
  CHECK (label IS NULL OR length(label) <= 80),
  CHECK (position >= 0)
) STRICT;

CREATE TABLE subscriptions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_micros INTEGER NOT NULL,
  currency TEXT NOT NULL,
  recurrence_unit TEXT NOT NULL,
  recurrence_count INTEGER NOT NULL DEFAULT 1,
  billing_anchor_on TEXT NOT NULL,
  anchor_mode TEXT NOT NULL DEFAULT 'calendar_day',
  next_billing_on TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  cancelled_at INTEGER,
  archived_at INTEGER,
  category_id TEXT,
  payment_method_id TEXT,
  website_url TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, category_id)
    REFERENCES categories(user_id, id) ON DELETE NO ACTION,
  FOREIGN KEY (user_id, payment_method_id)
    REFERENCES payment_methods(user_id, id) ON DELETE NO ACTION,
  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CHECK (amount_micros BETWEEN 0 AND 9007199254740991),
  CHECK (length(currency) = 3 AND currency = upper(currency)),
  CHECK (recurrence_unit IN ('day', 'week', 'month', 'year')),
  CHECK (recurrence_count BETWEEN 1 AND 1200),
  CHECK (billing_anchor_on GLOB '????-??-??'),
  CHECK (next_billing_on IS NULL OR next_billing_on GLOB '????-??-??'),
  CHECK (anchor_mode IN ('calendar_day', 'end_of_month')),
  CHECK (anchor_mode = 'calendar_day' OR recurrence_unit = 'month'),
  CHECK (status IN ('active', 'cancelled')),
  CHECK (
    (
      status = 'active'
      AND next_billing_on IS NOT NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'cancelled'
      AND next_billing_on IS NULL
      AND cancelled_at IS NOT NULL
    )
  ),
  CHECK (website_url IS NULL OR length(website_url) <= 2048),
  CHECK (notes IS NULL OR length(notes) <= 10000)
) STRICT;

CREATE INDEX idx_subscriptions_visible
  ON subscriptions(user_id, archived_at, next_billing_on, name);

CREATE INDEX idx_subscriptions_upcoming
  ON subscriptions(user_id, status, archived_at, next_billing_on);

CREATE INDEX idx_subscriptions_category
  ON subscriptions(user_id, category_id);

CREATE INDEX idx_subscriptions_payment_method
  ON subscriptions(user_id, payment_method_id);

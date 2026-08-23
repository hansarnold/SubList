ALTER TABLE users RENAME COLUMN default_currency TO reporting_currency;

ALTER TABLE users
  ADD COLUMN onboarding_completed_at INTEGER
  CHECK (onboarding_completed_at IS NULL OR onboarding_completed_at >= 0);

ALTER TABLE categories
  ADD COLUMN symbol_type TEXT
  CHECK (symbol_type IS NULL OR symbol_type IN ('icon', 'emoji'));

ALTER TABLE categories
  ADD COLUMN symbol_value TEXT
  CHECK (symbol_value IS NULL OR length(symbol_value) BETWEEN 1 AND 64);

ALTER TABLE payment_methods
  ADD COLUMN symbol_type TEXT
  CHECK (symbol_type IS NULL OR symbol_type IN ('icon', 'emoji'));

ALTER TABLE payment_methods
  ADD COLUMN symbol_value TEXT
  CHECK (symbol_value IS NULL OR length(symbol_value) BETWEEN 1 AND 64);

ALTER TABLE subscriptions
  ADD COLUMN symbol_type TEXT
  CHECK (symbol_type IS NULL OR symbol_type IN ('icon', 'emoji'));

ALTER TABLE subscriptions
  ADD COLUMN symbol_value TEXT
  CHECK (symbol_value IS NULL OR length(symbol_value) BETWEEN 1 AND 64);

CREATE TRIGGER categories_symbol_pair_insert
BEFORE INSERT ON categories
WHEN (NEW.symbol_type IS NULL) != (NEW.symbol_value IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_CATEGORY_SYMBOL_PAIR');
END;

CREATE TRIGGER categories_symbol_pair_update
BEFORE UPDATE OF symbol_type, symbol_value ON categories
WHEN (NEW.symbol_type IS NULL) != (NEW.symbol_value IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_CATEGORY_SYMBOL_PAIR');
END;

CREATE TRIGGER payment_methods_symbol_pair_insert
BEFORE INSERT ON payment_methods
WHEN (NEW.symbol_type IS NULL) != (NEW.symbol_value IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PAYMENT_METHOD_SYMBOL_PAIR');
END;

CREATE TRIGGER payment_methods_symbol_pair_update
BEFORE UPDATE OF symbol_type, symbol_value ON payment_methods
WHEN (NEW.symbol_type IS NULL) != (NEW.symbol_value IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PAYMENT_METHOD_SYMBOL_PAIR');
END;

CREATE TRIGGER subscriptions_symbol_pair_insert
BEFORE INSERT ON subscriptions
WHEN (NEW.symbol_type IS NULL) != (NEW.symbol_value IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_SUBSCRIPTION_SYMBOL_PAIR');
END;

CREATE TRIGGER subscriptions_symbol_pair_update
BEFORE UPDATE OF symbol_type, symbol_value ON subscriptions
WHEN (NEW.symbol_type IS NULL) != (NEW.symbol_value IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_SUBSCRIPTION_SYMBOL_PAIR');
END;

CREATE TABLE fx_snapshot (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  rate_count INTEGER NOT NULL,
  CHECK (id = 1),
  CHECK (provider = 'ecb'),
  CHECK (rate_date GLOB '????-??-??'),
  CHECK (base_currency = 'EUR'),
  CHECK (fetched_at >= 0),
  CHECK (rate_count > 0)
) STRICT;

CREATE TABLE fx_rates (
  snapshot_id INTEGER NOT NULL,
  currency TEXT NOT NULL,
  units_per_eur TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, currency),
  FOREIGN KEY (snapshot_id) REFERENCES fx_snapshot(id) ON DELETE CASCADE,
  CHECK (snapshot_id = 1),
  CHECK (length(currency) = 3 AND currency = upper(currency)),
  CHECK (length(units_per_eur) BETWEEN 1 AND 64),
  CHECK (units_per_eur NOT GLOB '*[^0-9.]*')
) STRICT;

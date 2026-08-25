-- Keep a monotonic per-user revision for import compare-and-swap guards.

ALTER TABLE users
  ADD COLUMN resource_revision INTEGER NOT NULL DEFAULT 0
  CHECK (resource_revision >= 0);

CREATE TRIGGER categories_resource_revision_insert
AFTER INSERT ON categories
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER categories_resource_revision_update
AFTER UPDATE ON categories
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER categories_resource_revision_delete
AFTER DELETE ON categories
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER payment_methods_resource_revision_insert
AFTER INSERT ON payment_methods
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER payment_methods_resource_revision_update
AFTER UPDATE ON payment_methods
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER payment_methods_resource_revision_delete
AFTER DELETE ON payment_methods
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER subscriptions_resource_revision_insert
AFTER INSERT ON subscriptions
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER subscriptions_resource_revision_update
AFTER UPDATE ON subscriptions
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = NEW.user_id;
END;

CREATE TRIGGER subscriptions_resource_revision_delete
AFTER DELETE ON subscriptions
BEGIN
  UPDATE users SET resource_revision = resource_revision + 1 WHERE id = OLD.user_id;
END;

CREATE TRIGGER categories_per_user_limit
BEFORE INSERT ON categories
WHEN (
  SELECT COUNT(*)
  FROM categories
  WHERE user_id = NEW.user_id
) >= 100
BEGIN
  SELECT RAISE(ABORT, 'RESOURCE_LIMIT_CATEGORIES');
END;

CREATE TRIGGER payment_methods_per_user_limit
BEFORE INSERT ON payment_methods
WHEN (
  SELECT COUNT(*)
  FROM payment_methods
  WHERE user_id = NEW.user_id
) >= 100
BEGIN
  SELECT RAISE(ABORT, 'RESOURCE_LIMIT_PAYMENT_METHODS');
END;

CREATE TRIGGER subscriptions_per_user_limit
BEFORE INSERT ON subscriptions
WHEN (
  SELECT COUNT(*)
  FROM subscriptions
  WHERE user_id = NEW.user_id
) >= 500
BEGIN
  SELECT RAISE(ABORT, 'RESOURCE_LIMIT_SUBSCRIPTIONS');
END;

DROP TRIGGER subscriptions_per_user_limit;

CREATE TRIGGER subscriptions_per_user_limit
BEFORE INSERT ON subscriptions
WHEN (
  SELECT COUNT(*)
  FROM subscriptions
  WHERE user_id = NEW.user_id
) >= 50
BEGIN
  SELECT RAISE(ABORT, 'RESOURCE_LIMIT_SUBSCRIPTIONS');
END;

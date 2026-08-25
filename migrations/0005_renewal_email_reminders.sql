-- Phase 4 renewal-email preferences and durable delivery outbox.

ALTER TABLE users
  ADD COLUMN preferred_locale TEXT NOT NULL DEFAULT 'en'
  CHECK (preferred_locale IN ('en', 'zh-Hans'));

ALTER TABLE users
  ADD COLUMN default_email_reminder_days_before INTEGER NOT NULL DEFAULT 7
  CHECK (default_email_reminder_days_before BETWEEN 0 AND 365);

ALTER TABLE users
  ADD COLUMN email_reminder_local_time TEXT NOT NULL DEFAULT '09:00'
  CHECK (
    length(email_reminder_local_time) = 5
    AND email_reminder_local_time GLOB '[0-2][0-9]:00'
    AND substr(email_reminder_local_time, 3, 3) = ':00'
    AND substr(email_reminder_local_time, 1, 2) BETWEEN '00' AND '23'
  );

ALTER TABLE users
  ADD COLUMN email_reminders_paused INTEGER NOT NULL DEFAULT 0
  CHECK (email_reminders_paused IN (0, 1));

ALTER TABLE users
  ADD COLUMN email_reminder_revision INTEGER NOT NULL DEFAULT 0
  CHECK (email_reminder_revision >= 0);

ALTER TABLE users
  ADD COLUMN email_reminder_suspension_reason TEXT
  CHECK (
    email_reminder_suspension_reason IS NULL
    OR email_reminder_suspension_reason = 'identity_email_conflict'
  );

-- This address is deliberately internal-only. It exists so the operator clear tool
-- can re-check ownership without accepting or displaying an email address.
ALTER TABLE users
  ADD COLUMN email_reminder_suspension_email_normalized TEXT
  CHECK (
    email_reminder_suspension_email_normalized IS NULL
    OR length(email_reminder_suspension_email_normalized) BETWEEN 4 AND 320
  );

CREATE TRIGGER users_email_reminder_suspension_pair_insert
BEFORE INSERT ON users
WHEN
  (NEW.email_reminder_suspension_reason IS NULL)
  != (NEW.email_reminder_suspension_email_normalized IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EMAIL_REMINDER_SUSPENSION_PAIR');
END;

CREATE TRIGGER users_email_reminder_suspension_pair_update
BEFORE UPDATE OF
  email_reminder_suspension_reason,
  email_reminder_suspension_email_normalized
ON users
WHEN
  (NEW.email_reminder_suspension_reason IS NULL)
  != (NEW.email_reminder_suspension_email_normalized IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EMAIL_REMINDER_SUSPENSION_PAIR');
END;

ALTER TABLE subscriptions
  ADD COLUMN email_reminder_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (email_reminder_enabled IN (0, 1));

ALTER TABLE subscriptions
  ADD COLUMN email_reminder_days_before INTEGER
  CHECK (email_reminder_days_before IS NULL OR email_reminder_days_before BETWEEN 0 AND 365);

ALTER TABLE subscriptions
  ADD COLUMN email_reminder_revision INTEGER NOT NULL DEFAULT 0
  CHECK (email_reminder_revision >= 0);

CREATE INDEX idx_subscriptions_email_reminder_planning
  ON subscriptions(user_id, billing_anchor_on)
  WHERE status = 'active'
    AND archived_at IS NULL
    AND email_reminder_enabled = 1;

CREATE TABLE renewal_email_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  billing_on TEXT NOT NULL,
  effective_days_before INTEGER NOT NULL,
  intended_send_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  lease_expires_at INTEGER,
  next_attempt_at INTEGER,
  sent_at INTEGER,
  provider_message_id TEXT,
  last_error_code TEXT,
  provider_key TEXT,
  provider_config_revision INTEGER,
  application_idempotency_key TEXT,
  template_version INTEGER,
  planned_user_reminder_revision INTEGER NOT NULL,
  planned_subscription_reminder_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id, subscription_id)
    REFERENCES subscriptions(user_id, id) ON DELETE CASCADE,
  UNIQUE (user_id, subscription_id, billing_on),
  CHECK (length(id) BETWEEN 1 AND 64),
  CHECK (billing_on GLOB '????-??-??'),
  CHECK (effective_days_before BETWEEN 0 AND 365),
  CHECK (intended_send_at >= 0),
  CHECK (expires_at > intended_send_at),
  CHECK (
    status IN (
      'pending',
      'sending',
      'retry_wait',
      'sent',
      'failed',
      'unknown',
      'cancelled',
      'expired'
    )
  ),
  CHECK (attempt_count BETWEEN 0 AND 3),
  CHECK (claimed_at IS NULL OR claimed_at >= 0),
  CHECK (lease_expires_at IS NULL OR lease_expires_at >= 0),
  CHECK (next_attempt_at IS NULL OR next_attempt_at >= 0),
  CHECK (sent_at IS NULL OR sent_at >= 0),
  CHECK (provider_config_revision IS NULL OR provider_config_revision > 0),
  CHECK (template_version IS NULL OR template_version > 0),
  CHECK (planned_user_reminder_revision >= 0),
  CHECK (planned_subscription_reminder_revision >= 0),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (
    (
      provider_key IS NULL
      AND provider_config_revision IS NULL
      AND application_idempotency_key IS NULL
      AND template_version IS NULL
    )
    OR
    (
      provider_key IS NOT NULL
      AND provider_config_revision IS NOT NULL
      AND application_idempotency_key IS NOT NULL
      AND template_version IS NOT NULL
    )
  ),
  CHECK (attempt_count = 0 OR provider_key IS NOT NULL),
  CHECK (status != 'sending' OR (claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status != 'retry_wait' OR next_attempt_at IS NOT NULL),
  CHECK (status != 'sent' OR sent_at IS NOT NULL)
) STRICT;

CREATE INDEX idx_renewal_email_deliveries_due
  ON renewal_email_deliveries(status, next_attempt_at, intended_send_at, expires_at);

CREATE INDEX idx_renewal_email_deliveries_subscription
  ON renewal_email_deliveries(user_id, subscription_id, intended_send_at DESC);

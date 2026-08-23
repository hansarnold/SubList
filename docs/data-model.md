# OpenSubLists Data Model

> Status: MVP specification  
> Last updated: 2026-08-23  
> Target database: Cloudflare D1  
> Purpose: Define a migration-ready relational model before implementation

## 1. Scope

This document defines the MVP persistence model for:

- Cloudflare Access identities and application users.
- Categories and payment methods.
- Recurring subscriptions.
- Tenant isolation and relationship integrity.
- Materialized next-billing dates.

The MVP does not persist charge transactions, pause periods, price history, exchange rates, reminder deliveries, or import history. Those features have migration paths described later in this document.

## 2. Core Decisions

### 2.1 One User Is One Tenant

The MVP has no shared workspaces. Each application user owns an independent dataset, so `user_id` is the tenant boundary on every business table.

If shared accounts or families become a real requirement, a later migration can introduce `accounts` and `account_memberships`. Adding that abstraction now would create authorization complexity without serving the current use case.

### 2.2 Authentication Identity Is Separate from the User

Cloudflare Access identities live in `auth_identities` instead of placing the Access subject directly on `users`.

This separation provides two practical benefits:

- A Cloudflare Access `sub` may change if a user is removed and later re-added to the Zero Trust organization.
- A future authentication provider can be added without changing every business relationship.

`users` is the stable application identity. `auth_identities` maps an external provider and subject to that user.

### 2.3 UUIDs and Composite Tenant Keys

- Application IDs are UUID strings generated with `crypto.randomUUID()`.
- `users.id` is a normal primary key.
- Tenant-owned resources use `PRIMARY KEY (user_id, id)`.
- API routes expose only the resource `id`, but every query also binds the verified `user_id`.

Composite keys allow category and payment method relationships to enforce same-user ownership at the database level.

### 2.4 Money Uses Integer Micro-units

Amounts use `amount_micros`, where one currency unit equals 1,000,000 micro-units:

```text
9.99 USD → 9,990,000
1,200 JPY → 1,200,000,000
```

The API accepts and returns decimal strings. The domain layer converts them to or from integer micro-units. Persisted amounts never use binary floating-point values.

### 2.5 Calendar Dates and Timestamps Are Different Types

- Calendar dates use ISO `YYYY-MM-DD` strings and field names ending in `_on`.
- Instants use Unix epoch milliseconds in `INTEGER` columns and field names ending in `_at`.
- Billing calculations interpret calendar dates in the owning user's IANA time zone.

The database validates basic shape where useful. The domain layer performs complete calendar and time-zone validation.

### 2.6 Cancellation and Archiving Are Orthogonal

- `status` represents billing lifecycle and is either `active` or `cancelled` in the MVP.
- `archived_at` controls whether the record is hidden from normal views.
- A cancelled subscription can remain visible or be archived later.
- Pausing is excluded until pause periods have explicit start and end dates.

The default destructive-looking action in the UI is Archive. Permanent deletion remains an explicit secondary action.

### 2.7 The Next Billing Date Is Materialized, Not Authoritative

`next_billing_on` exists for sorting, upcoming-charge queries, and future reminders. Its source of truth is:

- `billing_anchor_on`
- `recurrence_unit`
- `recurrence_count`
- `anchor_mode`
- `status`
- The user's local current date

Clients never choose `next_billing_on` directly. The server calculates it whenever schedule inputs change and reconciles stale values during reads or scheduled work.

## 3. Relationship Overview

```text
users
  ├──< auth_identities
  ├──< categories
  ├──< payment_methods
  └──< subscriptions
          ├── category_id --------> categories.id    (same user)
          └── payment_method_id --> payment_methods.id (same user)
```

All tenant-owned primary and foreign keys include `user_id`.

## 4. Table Definitions

## 4.1 users

Stores the stable application account and user preferences.

| Column | Type | Null | Description |
| --- | --- | --- | --- |
| id | TEXT | No | UUID primary key |
| primary_email | TEXT | No | Last verified display email |
| email_normalized | TEXT | No | Trimmed, lowercased identity key; unique |
| display_name | TEXT | Yes | Optional display name |
| timezone | TEXT | No | IANA time zone, default `UTC` |
| default_currency | TEXT | No | Uppercase ISO 4217 code, default `USD` |
| created_at | INTEGER | No | Unix epoch milliseconds |
| updated_at | INTEGER | No | Unix epoch milliseconds |

Notes:

- The MVP has no application-level owner or administrator role because Cloudflare Access manages admission and there is no admin UI.
- Email normalization is performed by the application. The original verified spelling remains in `primary_email`.
- An email address maps to one application user in one deployment.

## 4.2 auth_identities

Maps an external authenticated identity to a stable application user.

| Column | Type | Null | Description |
| --- | --- | --- | --- |
| provider | TEXT | No | `cloudflare_access`, or `local_development` in local environments only |
| subject | TEXT | No | Provider-stable subject, Access JWT `sub` |
| user_id | TEXT | No | Stable application user |
| email | TEXT | No | Email asserted by the provider |
| email_normalized | TEXT | No | Normalized asserted email |
| created_at | INTEGER | No | First observed time |
| last_seen_at | INTEGER | No | Most recent successful authentication |

Primary key: `(provider, subject)`.

Provisioning rules:

1. Look up `(provider, subject)`.
2. If found, update `last_seen_at` and refresh the asserted email fields.
3. If not found, look up `users.email_normalized`.
4. If exactly one user matches the verified email, attach the new identity to that user. This handles Access removal and re-addition.
5. Otherwise, create a new `users` row and identity in one D1 batch transaction.

Because email-based OTP proves control of the approved mailbox, verified-email relinking is acceptable for the invite-only MVP. The relink event should be logged without logging the JWT.

## 4.3 categories

| Column | Type | Null | Description |
| --- | --- | --- | --- |
| user_id | TEXT | No | Owning user |
| id | TEXT | No | UUID resource ID |
| name | TEXT | No | Display name |
| name_key | TEXT | No | Trimmed and normalized uniqueness key |
| color | TEXT | No | `#RRGGBB` display color |
| position | INTEGER | No | Manual ordering value, default `0` |
| created_at | INTEGER | No | Unix epoch milliseconds |
| updated_at | INTEGER | No | Unix epoch milliseconds |

Primary key: `(user_id, id)`.

`(user_id, name_key)` is unique. The application builds `name_key` by trimming, applying Unicode NFKC normalization, converting to locale-independent lowercase, and collapsing Unicode whitespace runs to one ASCII space. Categories are optional; an uncategorized subscription uses `category_id = NULL` rather than a special category row.

## 4.4 payment_methods

| Column | Type | Null | Description |
| --- | --- | --- | --- |
| user_id | TEXT | No | Owning user |
| id | TEXT | No | UUID resource ID |
| name | TEXT | No | Display name, such as `Visa` or `Apple` |
| kind | TEXT | No | `card`, `wallet`, `bank`, `store`, or `other` |
| label | TEXT | Yes | Optional safe label, such as `•••• 1234` |
| position | INTEGER | No | Manual ordering value, default `0` |
| created_at | INTEGER | No | Unix epoch milliseconds |
| updated_at | INTEGER | No | Unix epoch milliseconds |

Primary key: `(user_id, id)`.

The application never stores a full card number, bank credential, or payment secret. Payment method names do not need to be unique.

## 4.5 subscriptions

| Column | Type | Null | Description |
| --- | --- | --- | --- |
| user_id | TEXT | No | Owning user |
| id | TEXT | No | UUID resource ID |
| name | TEXT | No | Subscription name |
| amount_micros | INTEGER | No | Non-negative integer micro-units |
| currency | TEXT | No | Uppercase ISO 4217 code |
| recurrence_unit | TEXT | No | `day`, `week`, `month`, or `year` |
| recurrence_count | INTEGER | No | Positive unit multiplier, default `1` |
| billing_anchor_on | TEXT | No | Known billing occurrence in `YYYY-MM-DD` form |
| anchor_mode | TEXT | No | `calendar_day` or `end_of_month` |
| next_billing_on | TEXT | Yes | Server-maintained next occurrence |
| status | TEXT | No | `active` or `cancelled` |
| cancelled_at | INTEGER | Yes | Time cancellation was recorded |
| archived_at | INTEGER | Yes | Time the record was archived |
| category_id | TEXT | Yes | Optional same-user category |
| payment_method_id | TEXT | Yes | Optional same-user payment method |
| website_url | TEXT | Yes | Optional HTTPS or HTTP URL |
| notes | TEXT | Yes | Optional user notes |
| created_at | INTEGER | No | Unix epoch milliseconds |
| updated_at | INTEGER | No | Unix epoch milliseconds |

Primary key: `(user_id, id)`.

Lifecycle invariants:

- An active subscription has `next_billing_on` and no `cancelled_at`.
- A cancelled subscription has `cancelled_at` and no `next_billing_on`.
- Archiving does not modify status or schedule fields.
- Active archived subscriptions are excluded from dashboard totals by default.

Recurrence invariants:

- `recurrence_count` is between 1 and 1,200.
- `end_of_month` is valid only for monthly recurrence.
- `calendar_day` retains the original anchor day and clamps it to the last valid day of a shorter month.
- `end_of_month` always selects the final day of each target month.
- February 29 yearly schedules clamp to February's final day in non-leap years and return to February 29 in leap years.

## 5. Proposed MVP DDL

This DDL is intended to be migration-ready, but it remains a planning artifact until the model is approved and exercised against local D1.

```sql
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

CREATE INDEX idx_auth_identities_user
  ON auth_identities(user_id);

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
  CHECK (
    next_billing_on IS NULL
    OR next_billing_on GLOB '????-??-??'
  ),
  CHECK (anchor_mode IN ('calendar_day', 'end_of_month')),
  CHECK (
    anchor_mode = 'calendar_day'
    OR recurrence_unit = 'month'
  ),
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
  )
) STRICT;

CREATE INDEX idx_subscriptions_visible
  ON subscriptions(user_id, archived_at, next_billing_on, name);

CREATE INDEX idx_subscriptions_upcoming
  ON subscriptions(user_id, status, archived_at, next_billing_on);

CREATE INDEX idx_subscriptions_category
  ON subscriptions(user_id, category_id);

CREATE INDEX idx_subscriptions_payment_method
  ON subscriptions(user_id, payment_method_id);
```

All MVP tables use SQLite `STRICT` mode so that stored values cannot silently drift away from the declared D1 types. The visible-list and upcoming-charge indexes serve different filters. Their final column order should be checked with actual query plans after representative data is available.

## 6. Ownership and Deletion Rules

### 6.1 Users

Deleting a user is an administrative, permanent operation. D1 cascades the deletion to identities and tenant-owned data.

### 6.2 Subscriptions

- Archive is the default removal action.
- Unarchive restores normal visibility.
- Permanent deletion requires explicit confirmation.
- Future child records such as price changes and reminders should use `ON DELETE CASCADE` from a subscription.

### 6.3 Categories and Payment Methods

Categories and payment methods use same-tenant composite foreign keys. Removing one requires a transaction that:

1. Sets the corresponding subscription reference to `NULL` for the current user.
2. Deletes the category or payment method for the current user.

D1 `batch()` executes statements sequentially as a transaction and rolls back the sequence on failure, so it is appropriate for this workflow.

## 7. Next Billing Reconciliation

The domain layer owns schedule calculation. Database triggers must not contain calendar logic.

### 7.1 On Create or Schedule Edit

1. Validate the calendar date and recurrence rule.
2. Determine the user's current local date.
3. Calculate the first occurrence on or after that date.
4. Persist it as `next_billing_on`.

### 7.2 On Read

For a small account, the application may load active subscriptions and reconcile any `next_billing_on` earlier than the user's current local date. Corrections are written back in one batch after the response data is calculated.

### 7.3 Before Future Reminder Processing

A scheduled handler must reconcile stale dates before selecting reminders. Reminder delivery must use a separate idempotency table so recalculation cannot produce duplicate messages.

## 8. Main Query Shapes

All examples bind the verified server-side `user_id`.

### 8.1 Visible Subscription List

```sql
SELECT *
FROM subscriptions
WHERE user_id = ?
  AND archived_at IS NULL
ORDER BY next_billing_on, name;
```

### 8.2 Upcoming Expansion Candidates

After active subscriptions have been reconciled to the user's local today, select the subscriptions whose next occurrence could fall inside the requested window:

```sql
SELECT *
FROM subscriptions
WHERE user_id = ?
  AND status = 'active'
  AND archived_at IS NULL
  AND next_billing_on <= ?
ORDER BY next_billing_on, name;
```

The application layer expands each candidate with the billing domain rules and emits every occurrence through the inclusive window end. The database row is not itself an upcoming-charge record; daily and weekly subscriptions may produce multiple occurrences.

### 8.3 Next Active Charge

After read reconciliation, the earliest active and unarchived row supplies the starting schedule for the next-charge projection:

```sql
SELECT *
FROM subscriptions
WHERE user_id = ?
  AND status = 'active'
  AND archived_at IS NULL
  AND next_billing_on IS NOT NULL
ORDER BY next_billing_on, name
LIMIT 1;
```

The application maps the row to an occurrence response. This lookup is independent of the Dashboard upcoming-window filter.

### 8.4 Category Counts

The Dashboard count breakdown includes all active, unarchived subscriptions and retains the uncategorized group:

```sql
SELECT
  s.category_id,
  c.name AS category_name,
  c.color AS category_color,
  COUNT(*) AS subscription_count
FROM subscriptions AS s
LEFT JOIN categories AS c
  ON c.user_id = s.user_id
 AND c.id = s.category_id
WHERE s.user_id = ?
  AND s.status = 'active'
  AND s.archived_at IS NULL
GROUP BY s.category_id, c.name, c.color
ORDER BY subscription_count DESC, category_name;
```

### 8.5 Safe Resource Lookup

```sql
SELECT *
FROM subscriptions
WHERE user_id = ? AND id = ?;
```

No repository method may look up a tenant-owned resource by `id` alone.

## 9. Future Extensions

The following tables can be added without changing the MVP ownership model.

### 9.1 subscription_price_changes

- Composite ownership: `(user_id, subscription_id)`.
- Effective calendar date.
- Previous and new amounts in micro-units.
- Currency at the effective date.

### 9.2 subscription_pause_periods

- Composite ownership: `(user_id, subscription_id)`.
- Inclusive start date and optional end date.
- No overlapping periods for one subscription.
- Current paused state is derived from periods, not stored as a third subscription lifecycle status.

### 9.3 subscription_reminder_rules

- Composite ownership: `(user_id, subscription_id)`.
- Reminder lead days, channel, local delivery time, and enabled state.
- One subscription may support multiple future reminder rules without adding columns to the core subscription record.

### 9.4 reminder_deliveries

- User and subscription ownership.
- Billing occurrence date.
- Reminder lead days and channel.
- Delivery status and provider message ID.
- A uniqueness constraint preventing duplicate delivery for the same occurrence, lead time, and channel.

### 9.5 fx_rates

Exchange rates are deployment-global reference data rather than user-owned data. Rates store base currency, quote currency, effective date, source, and an exact decimal-string representation.

### 9.6 import_runs

Import runs record the user, source format, schema version, start and finish times, counts, and non-sensitive error summaries. Imported external IDs should live in a dedicated mapping table rather than in generic metadata JSON.

## 10. Explicit Non-goals

- No generic JSON metadata column on subscriptions.
- No shared account or membership abstraction in the MVP.
- No actual charge ledger or expense transaction history.
- No payment credentials or complete card details.
- No database trigger for recurrence calculations.
- No duplicate `user_id` accepted from request payloads.

## 11. Validation Responsibilities

The database enforces relational ownership, allowed enum values, non-negative amounts, and basic field shape. The domain layer additionally validates:

- UUID syntax.
- Real ISO calendar dates.
- IANA time zones.
- Supported ISO 4217 currencies.
- Decimal-string to micro-unit conversion without precision loss.
- URL schemes and length limits.
- Unicode normalization for category name keys.
- Recurrence and month-end behavior.
- Request payload size and note length.

## 12. Model Decision Checklist

Before turning this document into `migrations/0001_initial.sql`, confirm:

- [x] A user is the tenant boundary; shared workspaces are not required.
- [x] External authentication identities remain separate from application users.
- [x] The MVP has only active and cancelled lifecycle states; pause periods come later.
- [x] Archiving is independent from cancellation and is the default removal action.
- [x] Money uses integer micro-units.
- [x] Calendar dates use `YYYY-MM-DD`; audit timestamps use Unix milliseconds.
- [x] Monthly schedules expose an optional end-of-month anchor mode.
- [x] `next_billing_on` is a server-maintained materialized value.
- [x] Category names are unique per user after normalization.
- [x] Categories and payment methods are detached transactionally before deletion.

## 13. D1 References

- [Define foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
- [D1 Database batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

# OpenSubLists Data Model

> Status: Implemented baseline, reporting refactor, and provider-gated renewal email
>
> Last updated: 2026-08-24
>
> Target database: Cloudflare D1
>
> Purpose: Define the target relational model for implementation and maintainer cutover

## 1. Scope

This document defines the MVP persistence model for:

- Cloudflare Access identities and application users.
- Categories and payment methods.
- Recurring subscriptions.
- Common-icon and emoji symbols on user-facing resources.
- Deployment-shared daily FX snapshots and exact rates.
- Tenant isolation and relationship integrity.
- Materialized next-billing dates.

The implemented model does not persist charge transactions, payment state, pause
periods, price history, historical transaction valuation, or import history. It does
persist provider-gated reminder preferences and a delivery outbox, but still does not
create a charge or payment ledger.

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

### 2.8 Symbols and FX Reference Data Are Explicit

Categories, payment methods, and subscriptions store a nullable symbol pair. `icon` values are validated application tokens and `emoji` values are one validated Unicode grapheme; arbitrary markup and image locations are not persistence concepts.

FX snapshots are shared reference data for the deployment rather than tenant-owned business records. They contain provider facts only and never overwrite a subscription's original amount or currency.

## 3. Relationship Overview

```text
users
  ├──< auth_identities
  ├──< categories
  ├──< payment_methods
  └──< subscriptions
          ├── category_id --------> categories.id    (same user)
          ├── payment_method_id --> payment_methods.id (same user)
          └──< renewal_email_deliveries

fx_snapshot
  └──< fx_rates
```

All tenant-owned primary and foreign keys include `user_id`. FX rows have no `user_id` because one validated snapshot serves every tenant in the deployment.

`renewal_email_deliveries` is a child of
`subscriptions`. Its composite ownership key preserves tenant isolation, and its
foreign key cascades only on permanent subscription deletion.

## 4. Table Definitions

## 4.1 users

Stores the stable application account and user preferences.

| Column             | Type    | Null | Description                                            |
| ------------------ | ------- | ---- | ------------------------------------------------------ |
| id                 | TEXT    | No   | UUID primary key                                       |
| primary_email      | TEXT    | No   | Last verified display email                            |
| email_normalized   | TEXT    | No   | Trimmed, lowercased identity key; unique               |
| display_name       | TEXT    | Yes  | Optional display name                                  |
| timezone           | TEXT    | No   | IANA time zone, default `UTC`                          |
| reporting_currency | TEXT    | No   | Currency for combined estimates and new-record default |
| resource_revision  | INTEGER | No   | Internal monotonic revision for atomic import guards   |
| created_at         | INTEGER | No   | Unix epoch milliseconds                                |
| updated_at         | INTEGER | No   | Unix epoch milliseconds                                |

Notes:

- The MVP has no application-level owner or administrator role because Cloudflare Access manages admission and there is no admin UI.
- Email normalization is performed by the application. The original verified spelling remains in `primary_email`.
- An email address maps to one application user in one deployment.

Migration `0006_resource_revisions.sql` adds `resource_revision` with a zero default
and non-negative check. D1 triggers increment it after every category, payment-method,
or subscription insert, update, or delete. Import confirmation compares this revision
and the reviewed user fields inside the same D1 batch that applies the archive. A
change aborts the whole batch and requires a new preview. The revision is internal and
is never returned by the API or included in an export.

Provider-gated reminder columns added by migration 0005:

| Column                                     | Type    | Null | Description                                                    |
| ------------------------------------------ | ------- | ---- | -------------------------------------------------------------- |
| preferred_locale                           | TEXT    | No   | `en` or `zh-Hans`; migration/default is `en`                   |
| default_email_reminder_days_before         | INTEGER | No   | Account default in `0..365`; migration/default is `7`          |
| email_reminder_local_time                  | TEXT    | No   | Whole-hour local `HH:00`; migration/default is `09:00`         |
| email_reminders_paused                     | INTEGER | No   | User-controlled suppression; migration/default is `0`          |
| email_reminder_revision                    | INTEGER | No   | System-owned envelope version; migration/default is `0`        |
| email_reminder_suspension_reason           | TEXT    | Yes  | System safety pause; initially `identity_email_conflict` only  |
| email_reminder_suspension_email_normalized | TEXT    | Yes  | Internal collision candidate paired with the suspension reason |

`preferred_locale` becomes the persisted account language rather than a copy of an
arbitrary request header. The UI updates it through the authenticated profile API.
`email_reminder_local_time` initially matches `^([01]\d|2[0-3]):00$`; arbitrary
minutes require an interval-based scheduler and are not accepted. D1 checks locale,
lead-day bounds, whole-hour shape, boolean `0 | 1` values, a non-negative revision, and
the suspension-reason allow-list. The additive migration backfills every existing row
with the defaults above and a null suspension reason. D1 cannot read the earlier
browser-only locale, so the upgraded UI asks an existing user to save the currently
selected browser locale when it differs from the persisted `en` default; no request
header silently overwrites it.

`email_reminder_revision` increments only when `primary_email`, time zone, preferred
locale, account lead time, or local delivery time actually changes. Display name,
reporting currency, reads, and no-op authentication refreshes do not advance it. User
pause and system suspension gate delivery separately and do not change the rendered
envelope revision.

## 4.2 auth_identities

Maps an external authenticated identity to a stable application user.

| Column           | Type    | Null | Description                                                            |
| ---------------- | ------- | ---- | ---------------------------------------------------------------------- |
| provider         | TEXT    | No   | `cloudflare_access`, or `local_development` in local environments only |
| subject          | TEXT    | No   | Provider-stable subject, Access JWT `sub`                              |
| user_id          | TEXT    | No   | Stable application user                                                |
| email            | TEXT    | No   | Email asserted by the provider                                         |
| email_normalized | TEXT    | No   | Normalized asserted email                                              |
| created_at       | INTEGER | No   | First observed time                                                    |
| last_seen_at     | INTEGER | No   | Most recent successful authentication                                  |

Primary key: `(provider, subject)`.

Provisioning rules:

1. Look up `(provider, subject)`.
2. If found, normalize the newly asserted verified email and resolve its owner before
   refreshing identity or user email fields.
3. If not found, look up `users.email_normalized`.
4. If exactly one user matches the verified email, attach the new identity to that user. This handles Access removal and re-addition.
5. Otherwise, create a new `users` row and identity in one D1 batch transaction.

For an existing identity, update `auth_identities.email`,
`auth_identities.email_normalized`, `users.primary_email`,
`users.email_normalized`, and the user's `updated_at` in one transaction when the new
normalized address is unowned or already belongs to that user. Advance
`email_reminder_revision` only when the verified address actually changes. If the
address belongs to a different user, including a unique-index race after the owner
check, fail account resolution with a stable identity-conflict error, retain the
previous addresses, and set
`email_reminder_suspension_reason = 'identity_email_conflict'` as a fail-closed
safeguard. The user-editable pause bit cannot clear this reason. An operator-only
runbook clears it after resolving the ownership conflict; there is no public API for
that mutation.

Because email-based OTP proves control of the approved mailbox, verified-email relinking is acceptable for the invite-only MVP. A successful relink emits a structured security-audit event containing only the stable event code, internal user ID, and provider; it does not log the JWT, email, or provider subject.

## 4.3 categories

| Column       | Type    | Null | Description                           |
| ------------ | ------- | ---- | ------------------------------------- |
| user_id      | TEXT    | No   | Owning user                           |
| id           | TEXT    | No   | UUID resource ID                      |
| name         | TEXT    | No   | Display name                          |
| name_key     | TEXT    | No   | Trimmed and normalized uniqueness key |
| color        | TEXT    | No   | `#RRGGBB` display color               |
| symbol_type  | TEXT    | Yes  | `icon`, `emoji`, or `NULL`            |
| symbol_value | TEXT    | Yes  | Icon token, one emoji, or `NULL`      |
| position     | INTEGER | No   | Manual ordering value, default `0`    |
| created_at   | INTEGER | No   | Unix epoch milliseconds               |
| updated_at   | INTEGER | No   | Unix epoch milliseconds               |

Primary key: `(user_id, id)`.

`(user_id, name_key)` is unique. The application builds `name_key` by trimming, applying Unicode NFKC normalization, converting to locale-independent lowercase, and collapsing Unicode whitespace runs to one ASCII space. Categories are optional; an uncategorized subscription uses `category_id = NULL` rather than a special category row.

## 4.4 payment_methods

| Column       | Type    | Null | Description                                   |
| ------------ | ------- | ---- | --------------------------------------------- |
| user_id      | TEXT    | No   | Owning user                                   |
| id           | TEXT    | No   | UUID resource ID                              |
| name         | TEXT    | No   | Display name, such as `Visa` or `Apple`       |
| kind         | TEXT    | No   | `card`, `wallet`, `bank`, `store`, or `other` |
| label        | TEXT    | Yes  | Optional safe label, such as `•••• 1234`      |
| symbol_type  | TEXT    | Yes  | `icon`, `emoji`, or `NULL`                    |
| symbol_value | TEXT    | Yes  | Icon token, one emoji, or `NULL`              |
| position     | INTEGER | No   | Manual ordering value, default `0`            |
| created_at   | INTEGER | No   | Unix epoch milliseconds                       |
| updated_at   | INTEGER | No   | Unix epoch milliseconds                       |

Primary key: `(user_id, id)`.

The application never stores a full card number, bank credential, or payment secret. Payment method names do not need to be unique.

## 4.5 subscriptions

| Column            | Type    | Null | Description                                   |
| ----------------- | ------- | ---- | --------------------------------------------- |
| user_id           | TEXT    | No   | Owning user                                   |
| id                | TEXT    | No   | UUID resource ID                              |
| name              | TEXT    | No   | Subscription name                             |
| amount_micros     | INTEGER | No   | Non-negative integer micro-units              |
| currency          | TEXT    | No   | Uppercase ISO 4217 code                       |
| recurrence_unit   | TEXT    | No   | `day`, `week`, `month`, or `year`             |
| recurrence_count  | INTEGER | No   | Positive unit multiplier, default `1`         |
| billing_anchor_on | TEXT    | No   | Known billing occurrence in `YYYY-MM-DD` form |
| anchor_mode       | TEXT    | No   | `calendar_day` or `end_of_month`              |
| next_billing_on   | TEXT    | Yes  | Server-maintained next occurrence             |
| status            | TEXT    | No   | `active` or `cancelled`                       |
| cancelled_at      | INTEGER | Yes  | Time cancellation was recorded                |
| archived_at       | INTEGER | Yes  | Time the record was archived                  |
| category_id       | TEXT    | Yes  | Optional same-user category                   |
| payment_method_id | TEXT    | Yes  | Optional same-user payment method             |
| symbol_type       | TEXT    | Yes  | `icon`, `emoji`, or `NULL`                    |
| symbol_value      | TEXT    | Yes  | Icon token, one emoji, or `NULL`              |
| website_url       | TEXT    | Yes  | Optional HTTPS or HTTP URL                    |
| notes             | TEXT    | Yes  | Optional user notes                           |
| created_at        | INTEGER | No   | Unix epoch milliseconds                       |
| updated_at        | INTEGER | No   | Unix epoch milliseconds                       |

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

Provider-gated reminder columns added by migration 0005:

| Column                     | Type    | Null | Description                                               |
| -------------------------- | ------- | ---- | --------------------------------------------------------- |
| email_reminder_enabled     | INTEGER | No   | Explicit boolean opt-in, default `0`                      |
| email_reminder_days_before | INTEGER | Yes  | Override in `0..365`; `NULL` inherits the account default |
| email_reminder_revision    | INTEGER | No   | System-owned envelope version, default `0`                |

The enabled field and nullable override are independent. `NULL` never means disabled,
and the account default never opts in a subscription. Existing rows and legacy imports
receive `email_reminder_enabled = 0`.

`email_reminder_revision` increments only when a field used by reminder eligibility,
schedule, or rendered content actually changes: name, amount, currency, recurrence,
email preference, lifecycle, or archive state. Notes, website, symbol, category,
payment method, reads, and no-op writes do not advance it.

Subscription writes compare the previously read `updated_at` and
`email_reminder_revision` in their `UPDATE` predicate. A mismatch returns a conflict
instead of allowing a stale whole-row mutation to restore a newer reminder choice.
When deletion detaches a category or payment method, D1 also advances the affected
subscription's `updated_at` so open editors become stale.

## 4.6 fx_snapshot

Stores one complete validated provider publication.

| Column        | Type    | Null | Description                                 |
| ------------- | ------- | ---- | ------------------------------------------- |
| id            | INTEGER | No   | Singleton primary key fixed to `1`          |
| provider      | TEXT    | No   | Provider key; initially `ecb`               |
| rate_date     | TEXT    | No   | Provider reference date in `YYYY-MM-DD`     |
| base_currency | TEXT    | No   | Provider base; `EUR` for ECB                |
| fetched_at    | INTEGER | No   | Successful fetch time in epoch milliseconds |
| rate_count    | INTEGER | No   | Number of validated rates in the snapshot   |

Primary key: `id`. Exactly one row exists. A successful refresh atomically replaces
this row and every associated rate; the database does not accumulate FX history.

## 4.7 fx_rates

| Column        | Type    | Null | Description                                    |
| ------------- | ------- | ---- | ---------------------------------------------- |
| snapshot_id   | INTEGER | No   | Fixed to `1`; foreign-key and primary-key part |
| currency      | TEXT    | No   | Uppercase quote currency and primary-key part  |
| units_per_eur | TEXT    | No   | Canonical positive decimal units per EUR       |

Primary key: `(snapshot_id, currency)`. `snapshot_id` references `fx_snapshot(id)`
with `ON DELETE CASCADE`. Every snapshot includes `EUR = 1`.

## 5. Target DDL

This DDL is intended to be migration-ready, but it remains a planning artifact until the model is approved and exercised against local D1.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  reporting_currency TEXT NOT NULL DEFAULT 'USD',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 64),
  CHECK (length(trim(primary_email)) > 3),
  CHECK (
    length(reporting_currency) = 3
    AND reporting_currency = upper(reporting_currency)
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
  symbol_type TEXT,
  symbol_value TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (length(name_key) BETWEEN 1 AND 160),
  CHECK (length(color) = 7 AND substr(color, 1, 1) = '#'),
  CHECK (symbol_type IS NULL OR symbol_type IN ('icon', 'emoji')),
  CHECK ((symbol_type IS NULL) = (symbol_value IS NULL)),
  CHECK (symbol_value IS NULL OR length(symbol_value) BETWEEN 1 AND 64),
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
  symbol_type TEXT,
  symbol_value TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (kind IN ('card', 'wallet', 'bank', 'store', 'other')),
  CHECK (label IS NULL OR length(label) <= 80),
  CHECK (symbol_type IS NULL OR symbol_type IN ('icon', 'emoji')),
  CHECK ((symbol_type IS NULL) = (symbol_value IS NULL)),
  CHECK (symbol_value IS NULL OR length(symbol_value) BETWEEN 1 AND 64),
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
  symbol_type TEXT,
  symbol_value TEXT,
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
  CHECK (symbol_type IS NULL OR symbol_type IN ('icon', 'emoji')),
  CHECK ((symbol_type IS NULL) = (symbol_value IS NULL)),
  CHECK (symbol_value IS NULL OR length(symbol_value) BETWEEN 1 AND 64),
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
  CHECK (length(base_currency) = 3 AND base_currency = upper(base_currency)),
  CHECK (rate_count > 0)
) STRICT;

CREATE TABLE fx_rates (
  snapshot_id INTEGER NOT NULL,
  currency TEXT NOT NULL,
  units_per_eur TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, currency),
  FOREIGN KEY (snapshot_id)
    REFERENCES fx_snapshot(id) ON DELETE CASCADE,
  CHECK (snapshot_id = 1),
  CHECK (length(currency) = 3 AND currency = upper(currency)),
  CHECK (length(units_per_eur) BETWEEN 1 AND 64)
) STRICT;
```

All target tables use SQLite `STRICT` mode so stored values cannot silently drift away from declared D1 types. Domain validation still proves that rate strings are canonical positive decimals, icon tokens are allow-listed, and emoji contain one grapheme. The visible-list and upcoming-charge indexes serve distinct filters and must be checked with `EXPLAIN QUERY PLAN` after representative data is available.

The maintainer cutover targets a fresh D1 database, so the implemented migration sequence may be squashed into one reviewed baseline rather than carrying compatibility migrations into the new database. The baseline retains atomic per-user guard triggers for 100 categories, 100 payment methods, and 50 subscriptions. The old production database remains untouched as a rollback source until explicit acceptance.

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

### 7.3 Before Reminder Processing

A scheduled handler must reconcile stale dates before selecting reminders, but it
must not treat `next_billing_on` as the only candidate. For the user's planning local
date `D`, it resolves the effective lead days, computes `D + leadDays`, and asks the
authoritative recurrence rule whether that date is an occurrence. This handles lead
times that equal or exceed short recurrence intervals.

Only active, unarchived, explicitly enabled subscriptions belonging to an account that
is not globally paused are eligible. Reminder delivery uses a separate idempotency
table keyed to the billing occurrence so recalculation, time-zone changes, or lead-time
edits cannot produce a second logical delivery row for the same occurrence.

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

### 8.4 Category Breakdown Inputs

The Dashboard category breakdown includes all active, unarchived subscriptions, retains the uncategorized group, and projects display symbols. Exact normalized and converted amounts are calculated by the application domain from the selected subscription rows and one FX snapshot.

```sql
SELECT
  s.category_id,
  c.name AS category_name,
  c.color AS category_color,
  c.symbol_type AS category_symbol_type,
  c.symbol_value AS category_symbol_value,
  COUNT(*) AS subscription_count
FROM subscriptions AS s
LEFT JOIN categories AS c
  ON c.user_id = s.user_id
 AND c.id = s.category_id
WHERE s.user_id = ?
  AND s.status = 'active'
  AND s.archived_at IS NULL
GROUP BY
  s.category_id,
  c.name,
  c.color,
  c.symbol_type,
  c.symbol_value
ORDER BY subscription_count DESC, category_name;
```

### 8.5 Payment-method Breakdown Inputs

Payment-method breakdowns follow the same active, unarchived filter and retain a `NULL`
group for subscriptions without a payment method. The query projects name, kind,
symbol fields, and count; the application layer owns exact reporting calculations.

### 8.6 Safe Resource Lookup

```sql
SELECT *
FROM subscriptions
WHERE user_id = ? AND id = ?;
```

No repository method may look up a tenant-owned resource by `id` alone.

### 8.7 Current FX Snapshot

Read `fx_snapshot` at singleton ID `1` and all `fx_rates` for the same snapshot in one
repository operation. The application validates completeness for the currencies in the
Dashboard request before producing combined estimates.

## 9. Reminder Delivery and Future Extensions

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

### 9.3 renewal_email_deliveries — Implemented and Provider-gated

- `id`, plus composite ownership in `user_id` and `subscription_id`.
- `billing_on`, `effective_days_before`, `intended_send_at`, and exclusive UTC
  `expires_at` for the start of the next intended local date.
- `status` constrained to `pending`, `sending`, `retry_wait`, `sent`, `failed`,
  `unknown`, `cancelled`, or `expired`.
- Non-negative `attempt_count`, nullable `claimed_at`, 15-minute
  `lease_expires_at`, and nullable `next_attempt_at`.
- Nullable `sent_at`, opaque `provider_message_id`, and stable redacted
  `last_error_code`.
- `provider_key`, `provider_config_revision`, `application_idempotency_key`,
  `template_version`, `planned_user_reminder_revision`, and
  `planned_subscription_reminder_revision`; provider and version fields may be null
  before the first attempt and become immutable together when that attempt is claimed.
- `created_at` and `updated_at` audit timestamps.
- Composite foreign key to subscriptions with `ON DELETE CASCADE`.
- Unique `(user_id, subscription_id, billing_on)`; lead days are not part of the key.
- A due-work index over `(status, next_attempt_at, intended_send_at, expires_at)` and
  the subscription-side partial index for active, unarchived, enabled rows.
- No copied recipient address, rendered subject/body, or raw provider response.

The first release supports one logical reminder row per occurrence and therefore uses
explicit account/subscription fields instead of a generic rules engine. External
exactly-once delivery is not claimed unless a provider accepts the application
idempotency key. If multiple channels or multiple configured reminders per occurrence
are later approved, migrate the preferences to a dedicated rules table rather than
adding unbounded columns.

The authoritative transitions are:

- Planner creates `pending`; an atomic claim moves `pending` or a due `retry_wait` row
  to `sending`, increments the attempt count, sets fresh claim and lease timestamps,
  and clears `next_attempt_at`.
- Provider `accepted` moves to `sent`.
- Provider `definitely_not_accepted_retryable` moves to `retry_wait`, for at most three
  total attempts before `expires_at`; on attempt three it moves to `failed` with the
  stable `retry_exhausted` code.
- Provider `permanent` moves to `failed`.
- Provider `ambiguous`, including an expired native-provider `sending` lease, moves to
  `unknown` and is never retried automatically.
- A `pending` or `retry_wait` row discovered at or after `expires_at` moves to
  `expired`; a stale `sending` row takes the `unknown` transition instead.

Before the first provider attempt, preference or schedule changes may reschedule or
cancel a pending row. A global pause gates both `pending` and `retry_wait` until
unpaused or expired; an unpause resumes only rows whose frozen versions still match.
Opt-out, cancellation, or archive moves `pending` or safe `retry_wait` work to
`cancelled`. A cancelled row may reopen only when its attempt count is zero and the
newly calculated reminder window is still open; after any attempt, re-enabling applies
to the next occurrence. On first attempt, provider/configuration, template,
idempotency, and planned row versions freeze. A safe retry requires every version to
match; a mismatch becomes terminal `cancelled` instead of sending changed content or a
new destination. `sent`, `failed`, `unknown`, and `expired` rows never reopen for the
same occurrence.

### 9.4 import_runs

Import runs record the user, source format, schema version, start and finish times, counts, and non-sensitive error summaries. Imported external IDs should live in a dedicated mapping table rather than in generic metadata JSON.

## 10. Explicit Non-goals

- No generic JSON metadata column on subscriptions.
- No shared account or membership abstraction in the MVP.
- No actual charge ledger or expense transaction history.
- No amount, currency, payment-method, or manual-renewal rule that automatically opts a
  subscription into email.
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
- Paired symbol fields, allow-listed icon tokens, and single-grapheme emoji.
- Complete FX snapshots and canonical positive rate decimals.
- Recurrence and month-end behavior.
- Reminder lead-day bounds, whole-hour local delivery-time shape, persisted locale,
  lifecycle eligibility, delivery state transitions, one-logical-row-per-occurrence
  semantics, and explicit handling of ambiguous provider results.
- Request payload size and note length.

## 12. Model Decision Checklist

The implemented model confirms:

- [x] A user is the tenant boundary; shared workspaces are not required.
- [x] External authentication identities remain separate from application users.
- [x] The MVP has only active and cancelled lifecycle states; pause periods come later.
- [x] Archiving is independent from cancellation and is the default removal action.
- [x] Money uses integer micro-units.
- [x] Calendar dates use `YYYY-MM-DD`; audit timestamps use Unix milliseconds.
- [x] Monthly schedules expose an optional end-of-month anchor mode.
- [x] Combined estimates use deployment-shared, complete FX snapshots without rewriting original subscription money.
- [x] Presets remain application templates, while persisted symbols use explicit validated fields.
- [x] `next_billing_on` is a server-maintained materialized value.
- [x] Category names are unique per user after normalization.
- [x] Categories and payment methods are detached transactionally before deletion.

The reminder model passes these implementation gates:

- [x] Existing and legacy-migrated subscriptions default to email disabled; reviewed
      version-3 imports preserve only explicit saved choices.
- [x] Disabled and enabled-with-inherited-lead-time are distinct states.
- [x] Delivery uniqueness excludes lead days and includes the billing occurrence.
- [x] Scheduled selection uses recurrence projection for short intervals.
- [x] Reminder-specific revisions ignore reads, no-op identity refreshes, and pause
      toggles while covering every envelope-relevant mutation.
- [x] User pause and system safety suspension are independent and both gate delivery.
- [x] Recipient and rendered email content are not duplicated into delivery rows.

## 13. D1 References

- [Define foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
- [D1 Database batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

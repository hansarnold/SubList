# OpenSubLists API Contract

> Status: Implemented baseline, reporting refactor, and provider-gated renewal email
> Last updated: 2026-08-24
> Base path: `/api/v1`  
> Format: JSON over same-origin HTTPS

## 1. Principles

- The API is private and authenticated by Cloudflare Access.
- The API derives identity from a verified Access JWT and never accepts `userId` from the client.
- Database rows use snake_case; API fields use camelCase.
- Monetary inputs and outputs use decimal strings, not JavaScript numbers.
- Calendar dates use `YYYY-MM-DD`.
- Response timestamps use RFC 3339 UTC strings.
- Server-side domain rules are authoritative.
- Authenticated responses are not stored in a shared cache.

## 2. Authentication

Cloudflare Access places the application token in the `Cf-Access-Jwt-Assertion` request header. Authentication middleware verifies:

- Signature against the remote Access JWKS.
- Issuer.
- Application audience.
- Expiration and not-before claims.
- Presence of `sub` and verified email claims.

The middleware provisions or resolves the application user and exposes an internal request context:

```ts
type AuthContext = {
  userId: string;
  accessSubject: string;
  email: string;
};
```

This context is server-side only.

For a known identity, a changed verified Access email
refreshes both the identity and
`users.primary_email` transactionally when the normalized address is unowned or belongs
to the same user. A collision with another user fails account resolution with
`409 IDENTITY_EMAIL_CONFLICT`, preserves both accounts, and sets a system-owned
reminder suspension for the known user until an operator resolves the identity
conflict.

## 3. HTTP and Security Rules

- All endpoints require HTTPS in deployed environments.
- All API responses set `Cache-Control: private, no-store`.
- Unsafe methods require `Content-Type: application/json` when a body is present.
- Unsafe methods validate `Origin` against the configured public application origin.
- Browser requests include `X-Requested-With: XMLHttpRequest` so expired Access sessions can return a detectable `401`.
- Cross-origin resource sharing is disabled for the MVP.
- Tenant-owned resources that do not belong to the current user return `404`, not `403`.
- Prepared statements bind all dynamic SQL values.

## 4. Common Response Shape

Successful single-resource response:

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

Successful list response:

```json
{
  "data": [],
  "meta": {
    "count": 0
  }
}
```

The personal MVP returns at most 50 subscriptions per user and does not implement pagination. This keeps the fully expanded 30-day agenda within the Cloudflare Workers Free CPU and response-size budget. The response envelope permits cursor metadata to be added later without changing the top-level shape.

## 5. Error Shape

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "details": [
      {
        "path": "recurrence.anchorOn",
        "code": "INVALID_DATE",
        "message": "Use a real calendar date in YYYY-MM-DD form."
      }
    ],
    "requestId": "01K3..."
  }
}
```

Error messages are safe for users and must not include SQL, stack traces, JWTs, secrets, or another user's resource details.

Common codes:

| HTTP | Code                          | Meaning                                             |
| ---- | ----------------------------- | --------------------------------------------------- |
| 400  | `INVALID_JSON`                | Malformed JSON body                                 |
| 401  | `UNAUTHENTICATED`             | Missing, expired, or invalid Access token           |
| 404  | `NOT_FOUND`                   | Resource absent or not owned by current user        |
| 409  | `CONFLICT`                    | Unique-name or state-transition conflict            |
| 409  | `IDENTITY_EMAIL_CONFLICT`     | Verified email already belongs to a different user  |
| 409  | `EMAIL_REMINDERS_UNAVAILABLE` | Deployment has no enabled sender capability         |
| 409  | `EMAIL_REMINDERS_SUSPENDED`   | System safety suspension requires operator action   |
| 409  | `IMPORT_STATE_CHANGED`        | Account data changed; run import preview again      |
| 409  | `SUBSCRIPTION_STATE_CHANGED`  | Subscription changed; reload before retrying        |
| 413  | `PAYLOAD_TOO_LARGE`           | Request exceeds configured limit                    |
| 422  | `VALIDATION_ERROR`            | Structurally valid JSON with invalid fields         |
| 422  | `UNSUPPORTED_ARCHIVE_VERSION` | Archive schema is not the current supported version |
| 429  | `RATE_LIMITED`                | Request rate exceeded                               |
| 500  | `INTERNAL_ERROR`              | Unexpected server error                             |

## 6. Data Types

### 6.1 Identifiers

Identifiers are UUID strings. Client-generated IDs are not accepted for normal CRUD operations.

### 6.2 Money

```json
{
  "amount": "9.99",
  "currency": "USD"
}
```

- `amount` is a non-negative canonical decimal string.
- Scientific notation, separators, leading plus signs, and negative zero are rejected.
- The server converts the value to integer micro-units.
- The API does not expose `amountMicros`.

### 6.3 Dates

Calendar date:

```json
"2026-08-23"
```

Timestamp:

```json
"2026-08-23T08:15:30.123Z"
```

### 6.4 Nullable Values

Optional properties may be omitted on create. Responses use explicit `null` for nullable stored fields. A PATCH property set to `null` clears the field; an omitted property is unchanged.

### 6.5 Resource Symbols

```ts
type ResourceSymbol =
  { type: "icon"; value: CommonIconKey } | { type: "emoji"; value: string } | null;
```

`CommonIconKey` is a shared allow-list. Emoji values contain exactly one validated
extended grapheme. Arbitrary markup, image URLs, and component export names are
rejected.

## 7. Resource Schemas

## 7.1 User

```ts
type User = {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  reportingCurrency: string;
  onboardingCompletedAt: string | null;
  preferredLocale: "en" | "zh-Hans";
  defaultEmailReminderDaysBefore: number;
  emailReminderLocalTime: string;
  emailRemindersPaused: boolean;
  emailReminderSystemSuspended: boolean;
  createdAt: string;
  updatedAt: string;
};
```

The API does not expose authentication subject history.
`onboardingCompletedAt` is an RFC 3339 timestamp after first-run setup is
completed, or `null` before completion.

## 7.2 Category

```ts
type Category = {
  id: string;
  name: string;
  color: string;
  symbol: ResourceSymbol;
  position: number;
  createdAt: string;
  updatedAt: string;
};
```

Category names are unique per user after normalization.

## 7.3 Payment Method

```ts
type PaymentMethod = {
  id: string;
  name: string;
  kind: "card" | "wallet" | "bank" | "store" | "other";
  label: string | null;
  symbol: ResourceSymbol;
  position: number;
  createdAt: string;
  updatedAt: string;
};
```

## 7.4 Recurrence

```ts
type Recurrence = {
  unit: "day" | "week" | "month" | "year";
  count: number;
  anchorOn: string;
  anchorMode: "calendar_day" | "end_of_month";
};
```

`end_of_month` is valid only when `unit` is `month`.

## 7.5 Subscription

```ts
type Subscription = {
  id: string;
  name: string;
  amount: string;
  currency: string;
  recurrence: Recurrence;
  nextBillingOn: string | null;
  status: "active" | "cancelled";
  cancelledAt: string | null;
  archivedAt: string | null;
  categoryId: string | null;
  paymentMethodId: string | null;
  symbol: ResourceSymbol;
  websiteUrl: string | null;
  notes: string | null;
  emailReminderEnabled: boolean;
  emailReminderDaysBefore: number | null;
  createdAt: string;
  updatedAt: string;
};
```

`nextBillingOn`, `status`, `cancelledAt`, and `archivedAt` are controlled through server rules and lifecycle actions rather than directly on create.

## 7.6 Renewal-email Additions — Implemented and Provider-gated

`User` includes:

```ts
type RenewalEmailUserPreference = {
  preferredLocale: "en" | "zh-Hans";
  defaultEmailReminderDaysBefore: number;
  emailReminderLocalTime: string;
  emailRemindersPaused: boolean;
};

type RenewalEmailUserState = {
  emailReminderSystemSuspended: boolean;
};
```

`defaultEmailReminderDaysBefore` is an integer in `0..365`, and
`emailReminderLocalTime` is initially restricted to a whole-hour local value matching
`^([01]\d|2[0-3]):00$`. The account default never enables a subscription.
`emailReminderSystemSuspended` is read-only and exposes only the presence of an
operator-resolved safety suspension, not its internal reason.

`Subscription` gains:

```ts
type RenewalEmailSubscriptionPreference = {
  emailReminderEnabled: boolean;
  emailReminderDaysBefore: number | null;
};
```

`null` means inherit the account default. It never means disabled. New and legacy
subscriptions default to `false` and `null`.

`Session` also gains a non-secret deployment capability:

```ts
type SessionCapabilities = {
  emailReminders: boolean;
};
```

The capability reports whether the deployment has an enabled sender path. It does not
expose provider, sender-domain, recipient-verification, or secret details.

`PATCH /api/v1/me` accepts the four editable account preference fields, never
`emailReminderSystemSuspended`. Setting `emailRemindersPaused: false` while the sender
capability is unavailable returns `409 EMAIL_REMINDERS_UNAVAILABLE`; doing so while a
system suspension exists returns `409 EMAIL_REMINDERS_SUSPENDED`.

Subscription create and patch accept the two subscription fields, preserving the
distinction between omitted, `null`, and `false`. Capability gating applies to create
with `emailReminderEnabled: true` and to the stored transition `false -> true`, not to
an already-enabled record whose complete edit payload still contains `true`. Disabling
an existing preference always remains allowed.

Subscription Detail also returns a coarse, read-only summary:

```ts
type RenewalEmailDeliverySummary = {
  state: "none" | "scheduled" | "paused" | "retrying" | "sent" | "failed" | "unknown" | "expired";
  occurrenceOn: string | null;
  lastAttemptAt: string | null;
};

type SubscriptionDetail = Subscription & {
  emailReminderDelivery: RenewalEmailDeliverySummary;
};
```

The summary is provider-neutral and never includes an address, provider name, message
ID, or raw error. No full delivery-history endpoint is planned for the first release.
The hourly scheduled service uses internal cross-tenant repository authority, never an
HTTP route or a client-supplied `userId`.

Summary derivation is deterministic:

1. An opted-out, cancelled, or archived subscription returns `none`.
2. A row for today's local reminder window takes precedence over every later
   projection. Terminal states map by name; an attempted internal `cancelled` row
   maps to coarse `failed`, while an unattempted superseded row is ignored. An expired
   `sending` lease derives `unknown`. For non-terminal work,
   effective account/deployment suppression maps to `paused`, otherwise `pending` or an
   active `sending` lease maps to `scheduled` and `retry_wait` maps to `retrying`.
3. Without a current-window row, an opted-in subscription under user pause, system
   suspension, or unavailable sender returns `paused` for its next projected
   occurrence.
4. Otherwise, derive the earliest authoritative occurrence whose calculated local
   reminder window is current or future. A terminal or attempted delivery already
   locked to that billing occurrence remains visible instead of being projected as a
   second email; otherwise the state is `scheduled` even before its due-day outbox row
   exists. Do not substitute the inclusive `nextBillingOn`; for a short recurrence and
   a long lead time, the relevant reminder may belong to a later billing occurrence.
5. If there is no future eligible occurrence, return the most recent non-cancelled
   terminal state; with no such row, return `none` and null dates.

This precedence ensures a future daily projection cannot hide a failure or unknown
result from today's reminder window.

## 8. User Endpoints

### `GET /api/v1/session`

Returns the authenticated application user and the non-secret runtime environment:

```ts
type Session = {
  user: User;
  environment: "local" | "preview" | "production";
  capabilities: SessionCapabilities;
};
```

This is the browser's canonical bootstrap endpoint.

### `GET /api/v1/me`

Returns the current application user.

### `PATCH /api/v1/me`

Request:

```json
{
  "displayName": "Example User",
  "timezone": "Asia/Shanghai",
  "reportingCurrency": "CNY"
}
```

All fields are optional. Changing the time zone triggers next-billing reconciliation for active subscriptions. Changing reporting currency never rewrites an existing subscription amount or currency.

### `POST /api/v1/onboarding/complete`

Accepts no body or an empty JSON object. It idempotently records the first completion
timestamp and returns the current `User`; later calls preserve the original timestamp.

The Settings UI reads and writes the canonical `/api/v1/me` resource. There is no
duplicate `/api/v1/settings` API alias.

## 9. Category Endpoints

### `GET /api/v1/categories`

Returns categories ordered by `position`, then name.

### `POST /api/v1/categories`

```json
{
  "name": "Development Tools",
  "color": "#6366F1",
  "symbol": { "type": "icon", "value": "device" },
  "position": 0
}
```

Returns `201 Created` with the category.

### `PATCH /api/v1/categories/:id`

Accepts any subset of `name`, `color`, `symbol`, and `position`.

### `POST /api/v1/categories/batch`

Accepts a bounded array of ordinary category create inputs after the client has
localized and reviewed preset selections. The server does not accept preset keys and
does not persist preset provenance. The batch is atomic and returns the created rows.

### `DELETE /api/v1/categories/:id`

Atomically clears the category from the current user's subscriptions and deletes it. Returns `204 No Content`.

## 10. Payment Method Endpoints

### `GET /api/v1/payment-methods`

Returns payment methods ordered by `position`, then name.

### `POST /api/v1/payment-methods`

```json
{
  "name": "Visa",
  "kind": "card",
  "label": "•••• 1234",
  "symbol": { "type": "icon", "value": "brand_visa" },
  "position": 0
}
```

Returns `201 Created` with the payment method.

### `PATCH /api/v1/payment-methods/:id`

Accepts any subset of `name`, `kind`, `label`, `symbol`, and `position`.

### `DELETE /api/v1/payment-methods/:id`

Atomically clears the payment method from the current user's subscriptions and deletes it. Returns `204 No Content`.

## 11. Subscription Endpoints

### `GET /api/v1/subscriptions`

Optional query parameters:

| Parameter         | Values                                                    |
| ----------------- | --------------------------------------------------------- |
| `q`               | Case-insensitive name search                              |
| `status`          | `active`, `cancelled`, or omitted                         |
| `archived`        | `exclude` default, `only`, or `include`                   |
| `categoryId`      | Category UUID or `none`                                   |
| `paymentMethodId` | Payment method UUID or `none`                             |
| `currency`        | Uppercase ISO 4217 code                                   |
| `sort`            | `nextBillingOn` default, `name`, `amount`, or `createdAt` |
| `order`           | `asc` default or `desc`                                   |

`sort=amount` is accepted only when the request contains exactly one `currency`
filter. Cross-currency values are never compared as raw stored micro-units.

The server reconciles stale next-billing values before producing the final response.

### `POST /api/v1/subscriptions`

```json
{
  "name": "Example Service",
  "amount": "9.99",
  "currency": "USD",
  "recurrence": {
    "unit": "month",
    "count": 1,
    "anchorOn": "2026-08-31",
    "anchorMode": "calendar_day"
  },
  "categoryId": null,
  "paymentMethodId": null,
  "symbol": { "type": "emoji", "value": "✨" },
  "websiteUrl": "https://example.com",
  "notes": null
}
```

The server calculates `nextBillingOn` and returns `201 Created`.

### `GET /api/v1/subscriptions/:id`

Returns `SubscriptionDetail` for the current user, or `404`. List, create, and update
responses keep using `Subscription`; the delivery lookup is detail-only and does not
add ledger joins to every subscription query. The summary reports the relevant current
or most recent occurrence without exposing the internal delivery ledger.

### `PATCH /api/v1/subscriptions/:id`

Accepts an editable subset of:

- `name`
- `amount`
- `currency`
- `categoryId`
- `paymentMethodId`
- `symbol`
- `websiteUrl`
- `notes`
- `recurrence`

If any recurrence field changes, the client sends the complete `recurrence` object. The server recalculates `nextBillingOn`.

The write compares the previously read `updatedAt` and reminder revision inside D1.
If another request changed the row first, it returns
`409 SUBSCRIPTION_STATE_CHANGED` instead of overwriting that newer state. Deleting a
referenced category or payment method also advances the detached subscription's
`updatedAt`, so a stale editor cannot silently restore the old association.

Lifecycle and archival fields are rejected here and use explicit action endpoints.

### `POST /api/v1/subscriptions/:id/cancel`

Changes an active subscription to cancelled, records `cancelledAt`, and clears `nextBillingOn`. Repeating the action is idempotent and returns the current resource.

### `POST /api/v1/subscriptions/:id/reactivate`

Changes a cancelled subscription to active, clears `cancelledAt`, and recalculates `nextBillingOn`. Repeating the action is idempotent.

### `POST /api/v1/subscriptions/:id/archive`

Sets `archivedAt`. Repeating the action is idempotent.

### `POST /api/v1/subscriptions/:id/unarchive`

Clears `archivedAt`. If the subscription is active, the server reconciles `nextBillingOn`. Repeating the action is idempotent.

### `DELETE /api/v1/subscriptions/:id`

Permanently deletes the subscription after a UI confirmation. Returns `204 No Content`. The API does not provide an undo operation.

## 12. Dashboard Endpoint

### `GET /api/v1/dashboard`

Optional query parameter:

- `upcomingDays`: integer from 1 to 30, default 30.

Response shape:

```ts
type UpcomingCharge = {
  subscriptionId: string;
  name: string;
  amount: string;
  currency: string;
  billingOn: string;
  symbol: ResourceSymbol;
  category: {
    id: string;
    name: string;
    color: string;
    symbol: ResourceSymbol;
  } | null;
};

type ReportingEstimate = {
  amount: string;
  currency: string;
};

type FxStatus = {
  state: "not_needed" | "fresh" | "stale" | "unavailable";
  provider: "ecb" | null;
  rateDate: string | null;
  fetchedAt: string | null;
  missingCurrencies: string[];
};

type Dashboard = {
  localToday: string;
  upcomingThrough: string;
  nextCharge: UpcomingCharge | null;
  reporting: {
    currency: string;
    monthlyAverage: ReportingEstimate | null;
    annualized: ReportingEstimate | null;
    currentMonthCharges: ReportingEstimate | null;
    currentYearCharges: ReportingEstimate | null;
    fx: FxStatus;
  };
  totalsByCurrency: Array<{
    currency: string;
    monthlyEstimate: string;
    annualizedEstimate: string;
    upcomingAmount: string;
    currentMonthCharges: string;
    currentYearCharges: string;
  }>;
  upcoming: UpcomingCharge[];
  categoryBreakdown: Array<{
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    categorySymbol: ResourceSymbol;
    subscriptionCount: number;
    reportingMonthlyAverage: string | null;
    reportingAnnualized: string | null;
    totalsByCurrency: Array<{
      currency: string;
      monthlyEstimate: string;
      annualizedEstimate: string;
    }>;
  }>;
  paymentMethodBreakdown: Array<{
    paymentMethodId: string | null;
    paymentMethodName: string | null;
    paymentMethodKind: "card" | "wallet" | "bank" | "store" | "other" | null;
    paymentMethodSymbol: ResourceSymbol;
    subscriptionCount: number;
    reportingMonthlyAverage: string | null;
    reportingAnnualized: string | null;
    totalsByCurrency: Array<{
      currency: string;
      monthlyEstimate: string;
      annualizedEstimate: string;
    }>;
  }>;
};
```

`nextCharge` is the earliest active, unarchived occurrence on or after `localToday` and is independent of `upcomingDays`. `upcoming` contains every occurrence in the inclusive window from `localToday` through `upcomingThrough`; a subscription may appear multiple times when its recurrence repeats inside the window. Category and payment-method estimates include all active, unarchived subscriptions, not only subscriptions with an occurrence inside the selected window.

`totalsByCurrency` preserves exact original-currency groups. `reporting` combines all
eligible values through one ECB snapshot, except that a source amount already in the
reporting currency uses the exact identity conversion and requires no provider. Its current-month and current-year values
replay current subscription definitions across the complete local calendar period and
are estimates, not observed historical payments. If any included currency cannot be
converted, every combined estimate is `null` and `fx.missingCurrencies` explains why.
Estimates are rounded only at the response boundary.

## 13. Import and Export Endpoints

### `GET /api/v1/export`

Returns a versioned JSON archive with a download content disposition. Profile and
tenant resources are read from one consistent D1 batch snapshot. The exact format is
defined in `import-export.md`.

### `POST /api/v1/imports/preview`

Validates an archive without writing business data. The reminder-capable archive
version also requires the proposed `conflictStrategy` and `importProfile` so its safety
impact matches the reviewed merge; changing either option requires another preview.
It returns:

- Parsed schema version.
- Counts by resource type.
- Warnings and unsupported fields.
- Detected conflicts.
- A SHA-256 digest of the server's canonical serialization of the validated archive
  plus the reviewed options, conflict counts, sender capability, and reminder impact.
- For the reminder-capable archive version, a structured `reminderImpact` containing
  `enabledPreferencesAfterApply`, `senderCapabilityAvailable`, and
  `willForceGlobalPause` for the selected conflict strategy and profile option.

An integer `schemaVersion` other than the current version returns
`UNSUPPORTED_ARCHIVE_VERSION` before archive-field validation.

### `POST /api/v1/imports`

Confirms an import by uploading the archive again with its expected digest, an explicit
conflict strategy, profile option, and `confirmed: true`. The server repeats validation,
recomputes the review context from current account state, and rejects a digest mismatch.

The reminder-capable version re-evaluates capability and actual enabled preferences
after conflict resolution. A capability, conflict-state, or reminder-impact change
between preview and confirmation invalidates the approval digest and requires a fresh
preview. When the reviewed sender is unavailable and the resulting account has any
enabled preference, confirmation forces the user pause in the same transaction
regardless of `importProfile`. The response returns the final `reminderImpact`.

Confirmation also carries an internal compare-and-swap guard into the write batch. If
the account or any tenant resource changes between the confirmation read and the D1
batch, every import write is rolled back and the endpoint returns
`409 IMPORT_STATE_CHANGED`. The client must request a new preview instead of silently
retrying the stale confirmation.

## 14. Request Limits

Initial limits:

- JSON CRUD body: 64 KiB.
- Notes: 10,000 Unicode code points.
- Name: 120 Unicode code points for subscriptions; 80 for categories and payment methods.
- Import archive: 5 MiB.
- Search string: 120 Unicode code points.
- Per user: 100 categories, 100 payment methods, and 50 subscriptions.

Limits are enforced before expensive parsing or database work where practical.

## 15. Concurrency and Idempotency

- Category, payment-method, and profile PATCH operations use last-write-wins.
- Subscription PATCH and lifecycle writes use the previously read `updatedAt` plus
  reminder revision as a D1 compare-and-swap guard because a stale whole-row write
  could otherwise restore an opted-out reminder preference.
- Lifecycle actions are idempotent by definition.
- Create endpoints do not initially persist idempotency keys; the UI disables duplicate submission while a request is pending.
- Import confirmation requires the preview digest and repeats full validation to prevent accidental mismatch.
- Import apply uses a per-user resource revision and reviewed account fields as an
  in-transaction compare-and-swap guard; a concurrent change returns
  `IMPORT_STATE_CHANGED` with no partial import.

## 16. Logging

Each request receives a request ID. Structured logs may include:

- Request ID.
- Route template and method.
- Status code and duration.
- Internal user ID or a one-way hash when necessary for debugging.
- Stable application error code.

Request logs use the registered route template, such as
`/api/v1/subscriptions/:id`, never the concrete request path. Unexpected failures are
recorded only as `INTERNAL_ERROR`; raw exception messages are not persisted.

Logs must not include:

- Access JWTs or cookies.
- Full request bodies.
- Subscription notes.
- Payment method labels.
- Import archive contents.
- Concrete resource identifiers embedded in request paths.
- Reminder recipient addresses, subscription names, email subjects or bodies, provider
  response bodies, or raw provider exceptions.

## 17. Contract Testing

Required integration tests cover:

- Missing and invalid Access tokens.
- Every tenant-owned endpoint with another user's resource ID.
- Amount and date serialization.
- Full recurrence replacement on PATCH.
- Idempotent lifecycle actions.
- Category and payment method detachment on delete.
- API cache headers.
- Same-origin protection on unsafe methods.
- Error envelope consistency.
- Dashboard original-currency preservation and complete reporting-currency conversion.
- Dashboard fresh, stale, missing-rate, and provider-failure behavior.
- Complete current-month and current-year projections using current subscription definitions.
- Dashboard occurrence expansion for daily and weekly subscriptions.
- Dashboard next-charge behavior when the occurrence is outside the requested upcoming window.
- Dashboard category counts excluding cancelled and archived subscriptions.
- Category batch-create atomicity and normalized-name conflicts.
- Icon-token allow-list and single-grapheme emoji validation on every symbol-bearing resource.
- Reminder contract coverage includes `null = inherit`, explicit opt-in,
  account pause, capability-unavailable behavior, `0..365` bounds, persisted locale,
  and independent partial-update semantics.

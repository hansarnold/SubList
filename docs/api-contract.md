# OpenSubLists API Contract

> Status: MVP contract  
> Last updated: 2026-08-23  
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

| HTTP | Code                | Meaning                                      |
| ---- | ------------------- | -------------------------------------------- |
| 400  | `INVALID_JSON`      | Malformed JSON body                          |
| 401  | `UNAUTHENTICATED`   | Missing, expired, or invalid Access token    |
| 404  | `NOT_FOUND`         | Resource absent or not owned by current user |
| 409  | `CONFLICT`          | Unique-name or state-transition conflict     |
| 413  | `PAYLOAD_TOO_LARGE` | Request exceeds configured limit             |
| 422  | `VALIDATION_ERROR`  | Structurally valid JSON with invalid fields  |
| 429  | `RATE_LIMITED`      | Request rate exceeded                        |
| 500  | `INTERNAL_ERROR`    | Unexpected server error                      |

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

## 7. Resource Schemas

## 7.1 User

```ts
type User = {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  defaultCurrency: string;
  createdAt: string;
  updatedAt: string;
};
```

The API does not expose authentication subject history.

## 7.2 Category

```ts
type Category = {
  id: string;
  name: string;
  color: string;
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
  websiteUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
```

`nextBillingOn`, `status`, `cancelledAt`, and `archivedAt` are controlled through server rules and lifecycle actions rather than directly on create.

## 8. User Endpoints

### `GET /api/v1/me`

Returns the current application user.

### `PATCH /api/v1/me`

Request:

```json
{
  "displayName": "Arnold",
  "timezone": "Asia/Shanghai",
  "defaultCurrency": "CNY"
}
```

All fields are optional. Changing the time zone triggers next-billing reconciliation for active subscriptions.

## 9. Category Endpoints

### `GET /api/v1/categories`

Returns categories ordered by `position`, then name.

### `POST /api/v1/categories`

```json
{
  "name": "Development Tools",
  "color": "#6366F1",
  "position": 0
}
```

Returns `201 Created` with the category.

### `PATCH /api/v1/categories/:id`

Accepts any subset of `name`, `color`, and `position`.

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
  "position": 0
}
```

Returns `201 Created` with the payment method.

### `PATCH /api/v1/payment-methods/:id`

Accepts any subset of `name`, `kind`, `label`, and `position`.

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
  "websiteUrl": "https://example.com",
  "notes": null
}
```

The server calculates `nextBillingOn` and returns `201 Created`.

### `GET /api/v1/subscriptions/:id`

Returns one current-user subscription or `404`.

### `PATCH /api/v1/subscriptions/:id`

Accepts an editable subset of:

- `name`
- `amount`
- `currency`
- `categoryId`
- `paymentMethodId`
- `websiteUrl`
- `notes`
- `recurrence`

If any recurrence field changes, the client sends the complete `recurrence` object. The server recalculates `nextBillingOn`.

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
  category: {
    id: string;
    name: string;
    color: string;
  } | null;
};

type Dashboard = {
  localToday: string;
  upcomingThrough: string;
  nextCharge: UpcomingCharge | null;
  totalsByCurrency: Array<{
    currency: string;
    monthlyEstimate: string;
    annualizedEstimate: string;
    upcomingAmount: string;
  }>;
  upcoming: UpcomingCharge[];
  categoryBreakdown: Array<{
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    subscriptionCount: number;
    totalsByCurrency: Array<{
      currency: string;
      monthlyEstimate: string;
      annualizedEstimate: string;
    }>;
  }>;
};
```

`nextCharge` is the earliest active, unarchived occurrence on or after `localToday` and is independent of `upcomingDays`. `upcoming` contains every occurrence in the inclusive window from `localToday` through `upcomingThrough`; a subscription may appear multiple times when its recurrence repeats inside the window. Category counts and estimates include all active, unarchived subscriptions, not only subscriptions with an occurrence inside the selected window.

Different currencies remain separate. Estimates are rounded only at the response boundary.

## 13. Import and Export Endpoints

### `GET /api/v1/export`

Returns a versioned JSON archive with a download content disposition. The exact format is defined in `import-export.md`.

### `POST /api/v1/imports/preview`

Validates an archive without writing business data and returns:

- Parsed schema version.
- Counts by resource type.
- Warnings and unsupported fields.
- Detected conflicts.
- A SHA-256 digest of the server's canonical serialization of the validated archive.

### `POST /api/v1/imports`

Confirms an import by uploading the archive again with its expected digest, an explicit conflict strategy, and `confirmed: true`. The server repeats validation and rejects a digest mismatch.

The MVP implements this route atomically with the selected conflict strategy and per-user resource limits.

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

- The MVP uses last-write-wins for ordinary PATCH operations.
- Responses include `updatedAt` so optimistic concurrency can be introduced later.
- Lifecycle actions are idempotent by definition.
- Create endpoints do not initially persist idempotency keys; the UI disables duplicate submission while a request is pending.
- Import confirmation requires the preview digest and repeats full validation to prevent accidental mismatch.

## 16. Logging

Each request receives a request ID. Structured logs may include:

- Request ID.
- Route template and method.
- Status code and duration.
- Internal user ID or a one-way hash when necessary for debugging.
- Stable application error code.

Logs must not include:

- Access JWTs or cookies.
- Full request bodies.
- Subscription notes.
- Payment method labels.
- Import archive contents.

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
- Dashboard currency separation.
- Dashboard occurrence expansion for daily and weekly subscriptions.
- Dashboard next-charge behavior when the occurrence is outside the requested upcoming window.
- Dashboard category counts excluding cancelled and archived subscriptions.

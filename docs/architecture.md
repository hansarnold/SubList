# OpenSubLists Architecture and Technology Decisions

> Status: Implemented baseline, reporting refactor, and provider-gated renewal email
>
> Last updated: 2026-08-24
>
> Deployment target: Cloudflare Workers and D1

## 1. System Shape

```text
Browser
   │
   ▼
Cloudflare Access
   │
   ▼
Full-stack Worker
   ├── Static React application
   ├── Hono HTTP API
   ├── Access JWT middleware
   ├── Application services
   ├── D1 repositories
   ├── Scheduled ECB rate-refresh handler
   └── Hourly renewal-email handler
             │
             ├──> D1 preferences and delivery outbox
             └──> EmailSender provider port
```

The MVP is one deployable Worker plus one D1 database per environment. Worker count is not an architectural goal. Background work remains in the same Worker until an operational reason justifies splitting it.

## 2. Language Choices

| Layer                    | Choice                                                       |
| ------------------------ | ------------------------------------------------------------ |
| D1 schema and migrations | SQL using SQLite semantics                                   |
| D1 queries               | Parameterized SQL                                            |
| Worker and API           | TypeScript                                                   |
| Domain logic             | Runtime-independent TypeScript                               |
| Frontend                 | React with TypeScript/TSX                                    |
| Runtime configuration    | `wrangler.example.jsonc` template plus ignored operator copy |

TypeScript is the single application language so frontend previews, API schemas, and domain types can share definitions without maintaining a second implementation.

## 3. Selected Tools

### 3.1 Runtime and Build

- Cloudflare Workers module syntax.
- Vite with the Cloudflare Vite plugin.
- Wrangler for local development, generated runtime types, migrations, and deployment.
- Node.js 24 LTS is pinned in repository metadata.
- pnpm is the package manager, with a committed lockfile.

Exact package versions are pinned in `package.json`; planning documents do not duplicate version numbers that will become stale.

### 3.2 Frontend

- React.
- React Router.
- Plain CSS and CSS custom properties for styling and design tokens.
- No large UI framework in the MVP.
- UI copy is routed through a localization layer from the beginning.

Initial product locales are English and Simplified Chinese. Agent-facing documentation and code comments remain English.

### 3.3 HTTP API

- Hono for routing and middleware.
- Zod for external request and environment validation.
- Same-origin JSON API under `/api/v1`.
- Explicit action endpoints for lifecycle transitions.

Hono remains an HTTP adapter. Business rules must not be implemented in route handlers.

### 3.4 Database Access

- D1 Binding API.
- Explicit prepared SQL.
- SQLite `STRICT` tables.
- Numbered SQL migration files.
- Repository modules map database rows to domain objects.
- D1 `batch()` for multi-statement atomic operations.

The MVP does not use an ORM. The schema has few tables, uses composite tenant keys, and benefits from directly visible SQL constraints and query plans. Reconsider an ORM only if repetitive mapping or migration complexity becomes a demonstrated maintenance cost.

### 3.5 Testing

- Vitest for pure domain and application tests.
- A Workers-compatible integration environment for D1 and request tests.
- Browser-based QA for critical sign-in-independent UI flows using the loopback-only development identity.
- SQL schema smoke tests against local D1 and SQLite where semantics overlap.

## 4. Dependency Direction

```text
web ───────────────┐
                   ▼
http/api ──> application ──> domain
                   ▲
                   │
              infrastructure
              ├── d1
              ├── access
              ├── logging
              └── email provider
```

Rules:

- `domain` imports no UI, Hono, D1, or Workers modules.
- `application` coordinates use cases through repository interfaces.
- `infrastructure` implements repository and provider interfaces.
- `http/api` validates transport input and maps application results to HTTP.
- `web` consumes the API and may reuse pure validation or formatting helpers, but it does not import server infrastructure.

## 5. Proposed Source Layout

```text
src/
├── domain/
│   ├── billing/
│   ├── money/
│   ├── statistics/
│   ├── symbols/
│   └── validation/
├── application/
│   ├── subscriptions/
│   ├── categories/
│   ├── payment-methods/
│   ├── dashboard/
│   ├── fx/
│   └── ports/
├── worker/
│   ├── index.ts
│   ├── api/
│   ├── auth/
│   ├── db/
│   │   ├── repositories/
│   │   └── rows/
│   ├── jobs/
│   ├── providers/
│   └── observability/
├── web/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── i18n/
│   ├── presets/
│   ├── symbols/
│   └── styles/
└── shared/
    ├── api-types/
    └── icon-tokens/

migrations/
tests/
docs/
```

`shared/api-types` contains transport types and schemas that are safe in both browser and Worker bundles. It must not contain secrets or server-only behavior.

## 6. Type Boundaries

The project maintains distinct types for:

1. API request and response objects.
2. Domain entities and value objects.
3. D1 row representations.

They are mapped explicitly. A D1 row must not be returned directly from an endpoint.

Example:

```text
SubscriptionRow
  amount_micros: number
  billing_anchor_on: string

        ↓ repository mapping

Subscription
  amount: Money
  recurrence: Recurrence

        ↓ API mapping

SubscriptionResponse
  amount: "9.99"
  recurrence.anchorOn: "2026-08-31"
```

## 7. Domain Modules

### 7.1 Billing

Owns date-only recurrence calculation, materialized next-date reconciliation, and schedule validation.

### 7.2 Money

Owns canonical decimal parsing, safe micro-unit conversion, exact rational reporting calculations, rounding, and formatting inputs for the API.

### 7.3 Statistics

Owns original-currency grouping, exact FX conversion, reporting-currency aggregation, calendar-period projections, category and payment-method breakdowns, and monthly and annualized estimates.

### 7.4 Identity

Authentication verification is infrastructure. Stable user resolution and external-identity linking are application behavior backed by repositories.

### 7.5 Renewal Email — Implemented and Provider-gated

`RenewalReminderService` owns recurrence-based selection and orchestration through two
narrow ports: `ReminderStore` and `EmailSender`. The D1 implementation provides
cross-tenant scheduled scans, atomic claims, retries, and one delivery key per billing
occurrence. The provider adapter transports already-rendered text and HTML and
classifies failures without owning recurrence or tenant rules.

The authenticated detail read composes a separate `SubscriptionDetail` response from
the tenant-scoped subscription plus a provider-neutral reminder summary. Subscription
lists and ordinary write responses retain the base `Subscription` type and do not join
the operational delivery ledger.

The existing Worker runs a separate hourly Cron expression and dispatches scheduled
jobs by `controller.cron`, keeping reminder and FX failures independent. D1 is the
initial durable outbox; a Queue is not required at the personal 50-subscription account
limit. If later adopted, Queue messages contain only a delivery ID and the D1 ledger
remains authoritative because queue delivery is at least once.

Local and CI inject a fake `EmailSender` and never contact a mailbox. Production first
uses the native Cloudflare `send_email` binding with verified destinations. Provider
configuration is optional, and its absence becomes a non-secret runtime capability
rather than a startup failure for the core application.

The import application service receives that non-secret capability explicitly for the
reminder-capable archive version. Preview computes structured reminder impact for the
selected merge options; confirmation recomputes the actual merged enabled count and
forces the user pause in the same D1 transaction when no sender is available. This
safeguard is independent of whether profile preferences are otherwise imported.

The D1 uniqueness key guarantees one logical delivery row, not exactly-once physical
email. The native binding currently exposes no documented idempotency input, so an
ambiguous result becomes terminal `unknown` and is not automatically retried. The
service retries only a provider result that proves non-acceptance. A future adapter
with provider idempotency may resolve and retry an ambiguous transport event inside
the adapter before returning; any `ambiguous` outcome reported to the service remains
terminal without changing the planner or ledger.

The native adapter classifies an undocumented exception, timeout, or expired send
lease as ambiguous. It must not infer non-acceptance from a transport error alone, and
may have no retryable outcome until the provider offers positive proof of
non-acceptance.

## 8. Configuration

Worker environment bindings are represented by a generated `Env` type. Runtime types are regenerated from `wrangler.example.jsonc` with non-literal variable types whenever binding configuration changes. Operator-owned values live only in the ignored `wrangler.local.jsonc` file.

Configuration is validated once per isolate or request initialization path and exposed as a typed object. Missing production authentication settings fail closed.
Missing email configuration disables only the email capability. Real sender
domains, recipient restrictions, and any external provider secret stay in ignored
operator configuration or encrypted Worker secrets.

No environment binding is read directly from domain modules.

## 9. Error Handling

- Domain errors use stable internal codes and contain no HTTP concepts.
- Application services translate repository failures into application errors.
- API middleware maps application errors to the standard API envelope.
- Unexpected errors receive a request ID and a generic public message.
- Logs receive structured context without secrets or sensitive request content.

## 10. Caching

- Hashed static assets use long-lived public caching.
- The HTML application entry point revalidates.
- Authenticated API responses use `private, no-store`.
- Access JWKS data may be cached by the remote-key client.
- JWT verification and authorization decisions run on every request.
- D1 business results are not cached in the MVP.
- The singleton last known-good FX snapshot is persisted reference data in D1, not a cached authenticated API response.

## 11. Platform Compatibility and Data Portability

- Set an explicit Workers compatibility date and update it intentionally.
- Generate Worker types from the actual Wrangler configuration.
- Avoid Node.js APIs unless a dependency requires them and the compatibility flag is documented.
- Domain code uses standard TypeScript and web-platform primitives.
- SQL remains valid for D1's supported SQLite subset.
- Export data is independent of D1 row layout.
- While the deployment has one maintainer, the runtime supports only the current application database and archive shape. Approved breaking refactors use an offline export, deterministic transformation, verification report, fresh D1 target, and preserved rollback database rather than dual-read compatibility.

## 12. Change Triggers

Revisit these decisions only with concrete evidence:

| Decision          | Revisit when                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| One Worker        | Background work affects latency, permissions, or deployment isolation    |
| No ORM            | Mapping or migration boilerplate becomes a measured maintenance problem  |
| No Queue          | D1 outbox backlog, retry latency, or execution limits require a consumer |
| No R2             | User-uploaded images become an approved feature                          |
| User as tenant    | Shared subscriptions or family accounts become an approved feature       |
| No API pagination | An account needs more than the documented 50-subscription personal limit |

## 13. Official References

- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [Install and update Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- [Cloudflare Workers languages](https://developers.cloudflare.com/workers/languages/)
- [TypeScript on Workers](https://developers.cloudflare.com/workers/languages/typescript/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [D1 SQL API](https://developers.cloudflare.com/d1/sql-api/)
- [D1 Workers Binding API](https://developers.cloudflare.com/d1/worker-api/)
- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/how-queues-works/)
- [ECB Data API](https://data.ecb.europa.eu/help/api/data)

# OpenSubLists Pre-implementation Checklist

> Status: Complete for MVP scaffolding  
> Last updated: 2026-08-23

This checklist records the planning evidence required before application code is created.

## 1. Product Scope

- [x] Primary user and friend-preview audience defined.
- [x] Invite-only access defined.
- [x] MVP features defined.
- [x] Deferred features explicitly listed.
- [x] One-user-per-tenant boundary defined.

Evidence: [Product and Technical Plan](./plan.md)

## 2. Architecture and Stack

- [x] One full-stack Worker selected for the MVP.
- [x] D1 selected as the database.
- [x] TypeScript selected for Worker, domain, and frontend code.
- [x] SQL selected for D1 schema, migrations, and queries.
- [x] React, Vite, Hono, Zod, Vitest, Wrangler, and pnpm selected.
- [x] Explicit SQL selected instead of an ORM.
- [x] Module boundaries and dependency direction defined.

Evidence: [Architecture and Technology Decisions](./architecture.md)

## 3. Authentication and Authorization

- [x] Cloudflare Access OTP selected.
- [x] Access JWT verification claims defined.
- [x] Global and application session durations defined.
- [x] JWKS caching boundary defined.
- [x] Authorization caching rejected for the MVP.
- [x] Tenant-scoped query invariant defined.
- [x] Local-only identity adapter defined without a production impersonation path.
- [x] Alternate-route bypass prevention defined.

Evidence: [Product Plan](./plan.md), [API Contract](./api-contract.md), and [Environments and Deployment](./environments-and-deployment.md)

## 4. Data Model

- [x] MVP tables defined.
- [x] External identities separated from application users.
- [x] Composite tenant keys and foreign keys defined.
- [x] Money, date, timestamp, and ID representations defined.
- [x] Cancellation and archiving semantics separated.
- [x] Category normalization defined.
- [x] D1 `STRICT` DDL drafted and syntax-tested.
- [x] Deletion and cascade behavior tested with representative SQLite operations.
- [x] Future extension tables described.

Evidence: [Data Model](./data-model.md)

## 5. Billing and Reporting

- [x] Inclusive next-occurrence behavior defined.
- [x] Daily, weekly, monthly, and yearly recurrence defined.
- [x] Calendar-day and end-of-month modes defined.
- [x] Leap-day behavior defined.
- [x] Time-zone change behavior defined.
- [x] Materialized next-date reconciliation defined.
- [x] Exact annualized and monthly formulas defined.
- [x] Multi-currency separation defined.
- [x] Required example and property-test matrix defined.

Evidence: [Billing Rules](./billing-rules.md)

## 6. API

- [x] Versioned base path defined.
- [x] Authentication context and tenant behavior defined.
- [x] Request and response conventions defined.
- [x] Resource schemas defined.
- [x] CRUD and lifecycle endpoints defined.
- [x] Error envelope and status codes defined.
- [x] Request limits defined.
- [x] Cache, origin, and logging rules defined.
- [x] Contract-test expectations defined.

Evidence: [API Contract](./api-contract.md)

## 7. Import and Export

- [x] Versioned JSON archive envelope defined.
- [x] Exact V1 resource records defined.
- [x] Derived fields excluded and recalculated.
- [x] Preview and confirmation workflow defined.
- [x] Skip, overwrite, and duplicate conflict strategies defined.
- [x] Atomicity and size limits defined.
- [x] Archive evolution policy defined.
- [x] Native SubList adapter policy and warning behavior defined.
- [x] Security and privacy rules defined.

Evidence: [Import and Export](./import-export.md)

## 8. UI and Accessibility

- [x] Route and navigation map defined.
- [x] First-run experience defined.
- [x] Dashboard and list information order defined.
- [x] Create, edit, detail, and lifecycle interactions defined.
- [x] Settings and import flows defined.
- [x] Mobile and desktop behavior defined.
- [x] Loading, empty, error, and session-expired states defined.
- [x] Accessibility requirements defined.
- [x] English and Simplified Chinese localization requirement defined.

Evidence: [MVP UI Flow](./ui-flow.md)

## 9. Environments and Operations

- [x] Local, preview, and production isolation defined.
- [x] Local authentication safety defined.
- [x] Access and public-route settings defined.
- [x] Migration workflow defined.
- [x] CI quality gates defined.
- [x] Deployment and smoke-test sequence defined.
- [x] Logging redaction defined.
- [x] Backup, recovery, and rollback strategy defined.
- [x] Production readiness checklist defined.

Evidence: [Environments and Deployment](./environments-and-deployment.md)

## 10. Inputs Required During Implementation

These inputs do not block project scaffolding:

- Pin the active Node.js LTS and exact package versions in repository files.
- Create local, preview, and production Cloudflare resource configuration from examples.
- Obtain a redacted native SubList export before implementing its adapter.
- Supply real Access and D1 identifiers only through deployment configuration.

## 11. Next Authorized Engineering Step

The next implementation step is to scaffold the TypeScript Worker and React project, create `migrations/0001_initial.sql` from the approved data model, and implement the pure billing and money modules test-first.


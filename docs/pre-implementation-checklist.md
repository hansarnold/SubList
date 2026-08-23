# OpenSubLists Pre-implementation Checklist

> Status: Ready for MVP scaffolding
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
- [x] Node.js 24 LTS selected for the initial scaffold.
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
- [x] Upcoming totals and lists expand every recurrence occurrence inside the requested window.
- [x] Required example and property-test matrix defined.

Evidence: [Billing Rules](./billing-rules.md)

## 6. API

- [x] Versioned base path defined.
- [x] Authentication context and tenant behavior defined.
- [x] Request and response conventions defined.
- [x] Resource schemas defined.
- [x] CRUD and lifecycle endpoints defined.
- [x] Dashboard next-charge, occurrence-list, and category-count responses defined.
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
- [x] Desktop visual references selected for Dashboard and Subscriptions.
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

## 10. Local Scaffolding Start Gate

Planning and local runtime preparation no longer block application code:

- [x] Switch the workstation from Node.js 23.11.0, which is end-of-life, to Node.js 24 LTS.

The following are part of the scaffold itself rather than prerequisites that require another planning round:

- [ ] Pin Node.js in repository metadata and pin pnpm through the `packageManager` field.
- [ ] Create `package.json`, the pnpm lockfile, and the formatting, linting, type-checking, and test scripts.
- [ ] Install Wrangler locally as a development dependency; a global Wrangler installation is neither required nor preferred.
- [ ] Create `wrangler.jsonc` with local-safe values and preview/production placeholders.
- [ ] Generate the Worker `Env` type from the Wrangler configuration.
- [ ] Create `migrations/0001_initial.sql` from the approved D1 DDL.
- [ ] Add the initial CI workflow for install, format, lint, type-check, test, and build.

Cloudflare account IDs, D1 database IDs, Access audience values, and production hostnames are not required for local scaffolding. They become required before the first preview deployment.

## 11. Inputs Required During Implementation

These inputs do not block project scaffolding:

- Pin the active Node.js LTS and exact package versions in repository files.
- Create local, preview, and production Cloudflare resource configuration from examples.
- Obtain a redacted native SubList export before implementing its adapter.
- Supply real Access and D1 identifiers only through deployment configuration.

## 12. Next Authorized Engineering Step

The next implementation step is to scaffold the TypeScript Worker and React project, create `migrations/0001_initial.sql` from the approved data model, and implement the pure billing and money modules test-first.

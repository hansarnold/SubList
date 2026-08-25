# OpenSubLists Implementation Readiness Checklist

> Status: Phase 5 is implemented and verified, and migration 0007 is applied in
> production; the Phase 5 Worker rollout and email activation remain operator-gated
> Last updated: 2026-08-25

This checklist records both the planning evidence and the implementation gates for the MVP.

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

- [x] Current tables and refactor target tables defined.
- [x] External identities separated from application users.
- [x] Composite tenant keys and foreign keys defined.
- [x] Money, date, timestamp, and ID representations defined.
- [x] Cancellation and archiving semantics separated.
- [x] Category normalization defined.
- [x] D1 `STRICT` DDL drafted and syntax-tested.
- [x] Deletion and cascade behavior tested with representative SQLite operations.
- [x] FX singleton snapshot, symbol columns, and remaining future extensions described.

Evidence: [Data Model](./data-model.md)

## 5. Billing and Reporting

- [x] Inclusive next-occurrence behavior defined.
- [x] Daily, weekly, monthly, and yearly recurrence defined.
- [x] Calendar-day and end-of-month modes defined.
- [x] Leap-day behavior defined.
- [x] Time-zone change behavior defined.
- [x] Materialized next-date reconciliation defined.
- [x] Exact annualized and monthly formulas defined.
- [x] Original-currency preservation and complete reporting-currency conversion defined.
- [x] Monthly average, annualized, complete current-month, and complete current-year estimate semantics defined.
- [x] ECB snapshot freshness, completeness, and failure behavior defined.
- [x] Upcoming totals and lists expand every recurrence occurrence inside the requested window.
- [x] Required example and property-test matrix defined.

Evidence: [Billing Rules](./billing-rules.md)

## 6. API

- [x] Versioned base path defined.
- [x] Authentication context and tenant behavior defined.
- [x] Request and response conventions defined.
- [x] Resource schemas defined.
- [x] CRUD and lifecycle endpoints defined.
- [x] Dashboard next-charge, occurrence-list, reporting-currency, original-currency, category, and payment responses defined.
- [x] Resource symbol and category batch-create contracts defined.
- [x] Error envelope and status codes defined.
- [x] Request limits defined.
- [x] Cache, origin, and logging rules defined.
- [x] Contract-test expectations defined.

Evidence: [API Contract](./api-contract.md)

## 7. Import and Export

- [x] Versioned JSON archive envelope defined.
- [x] Target current-version resource records defined, including symbols and reporting currency.
- [x] Derived fields excluded and recalculated.
- [x] Preview and confirmation workflow defined.
- [x] Skip, overwrite, and duplicate conflict strategies defined.
- [x] Atomicity and size limits defined.
- [x] Current-only archive and offline maintainer transformation policy defined.
- [x] Native SubList adapter policy and warning behavior defined.
- [x] Security and privacy rules defined.

Evidence: [Import and Export](./import-export.md)

## 8. UI and Accessibility

- [x] Route and navigation map defined.
- [x] First-run experience defined.
- [x] Dashboard and list information order defined.
- [x] Wide-browser visual references selected for Dashboard and Subscriptions.
- [x] Create, edit, detail, and lifecycle interactions defined.
- [x] Settings and import flows defined.
- [x] Narrow- and wide-browser responsive behavior defined.
- [x] Loading, empty, error, and session-expired states defined.
- [x] Accessibility requirements defined.
- [x] English and Simplified Chinese localization requirement defined.
- [x] Localized preset catalogs and accessible common-icon/emoji picker defined.

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

## 10. Local Implementation Gate

Planning and local runtime preparation no longer block application code:

- [x] Switch the workstation from Node.js 23.11.0, which is end-of-life, to Node.js 24 LTS.

The local scaffold and implementation are complete:

- [x] Pin Node.js in repository metadata and pin pnpm through the `packageManager` field.
- [x] Create `package.json`, the pnpm lockfile, and the formatting, linting, type-checking, and test scripts.
- [x] Install Wrangler locally as a development dependency; a global Wrangler installation is neither required nor preferred.
- [x] Create `wrangler.example.jsonc` with loopback-safe local values and fail-closed hosted placeholders, while keeping operator-owned values in ignored `wrangler.local.jsonc`.
- [x] Generate the Worker `Env` type from the Wrangler configuration.
- [x] Create and locally apply the numbered D1 migrations.
- [x] Add the CI workflow for install, formatting, linting, type checking, tests, and bundle validation.
- [x] Implement and test the responsive website, API, authentication boundary, billing rules, and data portability flows.

Cloudflare account IDs, D1 database IDs, Access audience values, and production hostnames are not required for local scaffolding. The production values are now configured; preview remains intentionally unprovisioned.

## 11. Inputs Required Before Hosted Deployment

These inputs do not block local use:

- Obtain a redacted native SubList export before implementing its adapter.
- [x] Supply the real production origin, Access team domain, and audience value.
- [x] Create and bind the isolated production D1 database.
- [x] Configure the production Access OTP application and initial approved email policy.
- [x] Apply production migrations and deploy the production Worker and custom hostname.
- [x] Verify OTP login, Access JWT validation, and first-user provisioning in production.
- [ ] Provision equivalent isolated preview resources before enabling preview releases.

## 12. Next Delivery Step

Deploy the reviewed Phase 5 application with email still disabled, then treat
activation for one verified operator destination as a separate rollout. Provision
isolated preview resources before regular preview releases.

## 13. Refactor Implementation Gate — Complete

- [x] Implement target symbol, preset, FX, reporting, API, and archive domain types.
- [x] Implement and test the fresh target D1 baseline.
- [x] Implement the ECB adapter, singleton snapshot replacement, and daily scheduled handler.
- [x] Implement combined Dashboard estimates and original-currency transparency.
- [x] Implement first-run category quick add and payment preset prefills.
- [x] Implement shared common-icon and single-emoji selection and rendering.
- [x] Complete English and Simplified Chinese responsive and accessibility QA.
- [x] Preserve raw production export, D1 backup, transformed export, hashes, and review report.
- [x] Rehearse and verify the cutover before changing the production D1 binding.
- [x] Keep the previous Worker/database pair available until explicit operator acceptance.

## 14. Phase 4 Follow-up Gate — Deployed

- [x] Identify why empty category and payment-method selectors show only `None`.
- [x] Define one shared preset/custom creation flow for subscription Create and Edit.
- [x] Preserve the ordinary tenant-owned resource model without a D1 migration.
- [x] Define category and payment-method Bar and Donut metrics, disclosure, and sparse states.
- [x] Define a no-custom-domain GitHub Pages architecture for the public self-hosting guide.
- [x] Define explicit per-subscription email opt-in with account default and nullable
      override; reject amount and manual-renewal heuristics.
- [x] Define authoritative recurrence-based target selection for lead times that equal
      or exceed short billing intervals.
- [x] Define the D1 delivery ledger, one-logical-row-per-occurrence key, claim/retry
      model, terminal ambiguous-result policy, persisted locale, and global pause.
- [x] Define the exact delivery states, provider outcomes, claim and same-day expiry,
      re-enable behavior, and provider-neutral Subscription Detail summary.
- [x] Define existing-user defaults, collision-aware primary-email refresh, and
      reminder-import behavior when no sender is available.
- [x] Separate user pause from system suspension and replace generic timestamps with
      reminder-specific retry revisions.
- [x] Define the local-wall-time conversion primitive, pre-due derived status, retry
      claim transition, and unavailable-sender unpause gate.
- [x] Confirm the native Cloudflare verified-destination path for the initial free-plan
      owner/friend deployment and keep arbitrary-recipient delivery provider-gated.
- [x] Implement and test the shared resource association fields.
- [x] Correct the existing category bar metric and implement the approved chart views.
- [x] Build and validate the VitePress documentation site and Pages workflow locally.
- [x] Enable GitHub Actions as the Pages source, publish, and verify the default project URL.
- [x] Add reminder migrations, API/archive fields, UI, fake sender, D1 outbox, and
      hourly scheduled service.
- [ ] Configure a private sender binding, verify an operator destination, run the
      no-send scan, and inspect one operator delivery before enabling friend reminders.
- [x] Verify reminder localization, lifecycle suppression, duplicate Cron runs,
      retries, privacy-safe logs, and rollback by disabling the capability.

Evidence:
[Subscription Editor, Email Reminders, GitHub Pages, and Dashboard Charts Plan](./subscription-editor-docs-and-charts-plan.md)

## 15. Phase 5 Corrective Gate — Implemented; Release and Activation Pending

- [x] Diagnose the wide resource-row layout defect and ambiguous preset operations.
- [x] Define separate Interface language and Email language preferences with no
      mismatch warning.
- [x] Define compact Saved, Common, Create, and Add-and-select resource flows.
- [x] Define removal of non-actionable provider notices, disabled reminder controls,
      repeated statuses, Settings links inside selectors, and chart-mode buttons.
- [x] Define separate simultaneous Bar and Pie visualizations and one-group behavior.
- [x] Confirm that email activation reuses the existing Worker, hourly Cron, D1
      outbox, and provider adapter.
- [x] Confirm the verified-destination Free path, manual fake no-send run, natural
      production no-send run, operator-first delivery, and independent rollback.
- [x] Fix the reminder recipient to the current Access account email and reject every
      in-app, API, archive, and per-subscription recipient override.
- [x] Reconcile and implement the D1, API, archive V4, Settings, resource-picker, and
      Dashboard contracts.
- [x] Cover migration 0007 with fresh-database and populated-upgrade tests and add the
      strict offline V3-to-V4 archive transformer.
- [x] Create an exact production recovery point, apply migration 0007, and verify
      unchanged tenant-row counts plus the locale backfill.
- [ ] Transform and review any retained private V3 archive before a future import or
      transfer; keep both copies outside the repository.
- [x] Pass wide, narrow, keyboard, sparse-chart, FX, reminder, privacy, dry-run, and
      documentation checks.
- [ ] Verify one operator email before enabling any friend reminder.

Evidence:
[UX Simplification, Locale Separation, Email Activation, and Dashboard Charts Plan](./ux-simplification-locale-email-and-charts-plan.md)

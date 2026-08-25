# OpenSubLists Product and Technical Plan

> Status: MVP and Phase 4 deployed; Phase 5 is implemented and migration 0007 is
> applied in production, while the Phase 5 Worker rollout and email activation remain
> operator-gated
>
> Last updated: 2026-08-25
>
> Deployment target: Cloudflare
>
> Current phase: Phase 2 remains open for hosted lifecycle verification and isolated preview resources; Phase 5 Worker rollout and email activation remain operator actions

## 1. Project Overview

OpenSubLists is a simple, self-hostable subscription tracker. It does not aim to reproduce every feature of the native SubList application. Its initial purpose is to solve the following problems well:

- Record the subscription services a person currently uses.
- Calculate the next billing date accurately.
- Summarize monthly, annual, and upcoming expenses.
- Support a small number of invited users with strict account-level data isolation.
- Use as few Cloudflare components as reasonably possible.
- Provide a clear and repeatable open-source deployment path.

The first deployment will primarily serve the maintainer. A small number of friends may be invited later for testing. Public registration, monetization, and large-scale multi-tenant operation are out of scope for the initial phases.

## 2. Design Principles

1. **Architecture follows requirements.** Do not decide the number of Workers in advance or split services for hypothetical scale.
2. **Data correctness comes first.** Money, billing intervals, month-end dates, and time zones must not depend on ambiguous floating-point or date behavior.
3. **Private by default.** Authentication is invite-only, and every business query must be scoped to the current user.
4. **Portable data.** Standard JSON import and export must prevent deployment lock-in.
5. **Progressive enhancement.** Complete the approved estimated-reporting and
   organization workflow before the provider-gated renewal-email phase; actual
   transaction data and advanced imports remain later work.
6. **Cloudflare-native without unnecessary coupling.** The runtime targets Workers and D1, while core business rules remain independently testable TypeScript modules.

## 3. Reference Product and Scope Decisions

The locally installed SubList 2.4.0 application includes subscriptions, categories, payment methods, pause periods, price history, trials and offers, archiving, currency conversion, calendar and reminder integration, and data import/export.

The OpenSubLists MVP will focus on the primary workflow:

```text
Sign in → Review subscriptions → Add or edit → Review upcoming charges and spending → Export data
```

### 3.1 Included in the MVP

- Invite-only email authentication.
- Create, read, edit, archive, and delete subscriptions.
- Categories and payment methods.
- A category overview that groups active subscriptions without mixing browsing and
  category management.
- Daily, weekly, monthly, and yearly billing intervals with interval multipliers.
- Next billing date calculation.
- Monthly average, annualized, category, and upcoming-charge summaries.
- Combined estimated monthly, annualized, current-month, and current-year summaries in a user-selected reporting currency.
- Exact original-currency breakdowns and visible FX source, date, freshness, and failure state.
- Reporting-currency and time-zone settings.
- Localized category and payment-method creation presets.
- Direct preset and custom resource creation from subscription Create and Edit.
- Explicit per-subscription renewal email with an account lead-time default and
  optional subscription override (Phase 4 provider-gated).
- Allow-listed common icons or one emoji for categories, payment methods, and subscriptions.
- Amount-based category and payment-method breakdowns with simultaneously visible Bar
  and Pie views.
- JSON import and export.
- One responsive website for narrow and wide browser viewports.
- A published self-hosting documentation site at the repository's default GitHub
  Pages URL.

### 3.2 Excluded from the MVP

- Public registration and an in-app invitation system.
- App Store or screenshot-based AI import.
- Image uploads, remote favicons, a comprehensive subscription-brand logo library, and category backgrounds.
- Browser push notifications.
- Native calendar or reminders integration.
- Family sharing, shared payments, and subscription cost splitting.
- Automatic bill or bank transaction ingestion.
- Complex trials, tiered pricing, and introductory-offer models.
- An administrator console.

## 4. Recommended Architecture

### 4.1 MVP Deployment

```text
Browser
   │
   ▼
Cloudflare Access
   │  Approved email + one-time PIN
   ▼
Full-stack Worker
   ├── Static frontend assets
   ├── HTTP API
   ├── Identity parsing and authorization
   └── scheduled() handler when background work is needed
             │
             ▼
             D1
```

The initial deployment uses one Worker. Static assets, the API, the daily ECB
rate-refresh handler, and the provider-gated renewal-email handler remain in one
deployment unit. Renewal email uses a separate hourly Cron expression and
dispatches by `controller.cron` so the jobs fail independently. Scheduled work should
move to a separate Worker only when permissions, execution time, deployment cadence,
or fault isolation create a concrete need.

### 4.2 Components Not Needed Initially

- **Pages:** Worker Static Assets can serve the frontend.
- **KV:** Business data needs relational queries and transactional semantics; D1 is a better fit.
- **R2:** The MVP does not support image uploads.
- **Durable Objects:** There is no real-time collaboration or strong single-coordinator requirement.
- **Queues:** The reminder implementation uses D1 as a durable delivery outbox for the
  small user base. Add a queue only when measured retry latency, batch volume, or
  execution limits justify the extra boundary.

### 4.3 Conditions for Future Service Splitting

Reconsider a separate Jobs Worker or Queue when any of the following becomes true:

- Scheduled work measurably affects online API latency.
- Email credentials require a separate permission boundary.
- A single scheduled run approaches Worker execution limits.
- Reliable retries, large batches, or dead-letter handling are needed.
- Online and background services require independent release and rollback cycles.

## 5. Proposed Technology Stack

- Language: TypeScript.
- Frontend: React and Vite.
- API: Hono with a thin routing layer.
- Database: Cloudflare D1.
- Query layer: Explicit parameterized SQL behind repository interfaces; no ORM in the MVP.
- Validation: Zod or an equivalent schema validation library.
- Testing: Vitest. Date and money rules require unit tests.
- Deployment: Wrangler.
- Authentication: Cloudflare Access OTP.

React lowers the contribution barrier for an open-source project. Core calculation logic must not depend on React, Hono, or Workers runtime APIs.

## 6. Identity and Security Model

### 6.1 Sign-in Flow

1. The operator adds an approved email address to a Cloudflare Access policy.
2. The user signs in with a one-time email PIN.
3. The Worker validates the Access JWT signature, issuer, and audience.
4. The application uses the JWT `sub` claim as the external identity. Email is used only for display and contact.
5. The application creates a local `users` record on the first authenticated request.

### 6.2 Tenant Isolation

- Every business table must contain `user_id`.
- Every read, update, and delete must query by both resource ID and `user_id`.
- The API must never accept `user_id` from the client. It must derive the user from verified server-side identity.
- Foreign keys such as category and payment method references must prevent cross-user relationships.
- Disable or protect any `workers.dev` address that could bypass Access.
- Validate the same-origin `Origin` on write requests and apply appropriate CSRF protection.

### 6.3 User Administration

The MVP does not include an administrator interface. Cloudflare Access policies handle invitations and access removal. Local user records remain available for auditing and data export. Removing login access must not automatically delete user data.

### 6.4 Session and Authentication Caching

Authentication state is managed by Cloudflare Access rather than by an application-owned session table:

- Set the Access global session duration to 30 days.
- Set the application or policy session duration to 7 days.
- When an application token expires while the global session is still valid, Access may re-evaluate the policy and issue a new application token without requiring another email PIN.
- The Worker reads the application token from the `Cf-Access-Jwt-Assertion` header and verifies its signature, issuer, audience, expiry, and not-before claims on every request.

The Worker may cache the remote Access JSON Web Key Set (JWKS), but it must not hard-code signing keys. The JWKS client must refresh when it encounters an unknown `kid` so that Access key rotation does not interrupt authentication. JWT verification results are not cached; local signature verification runs for every request.

The application does not cache authorization decisions by default. User roles and resource ownership remain authoritative in D1. A small deployment does not justify the invalidation complexity or revocation delay introduced by an authorization cache.

### 6.5 HTTP Cache Policy

- Authenticated API responses use `Cache-Control: private, no-store` by default.
- API responses must never enter a shared cache keyed only by URL, because identical routes serve different tenants.
- Static assets with content-hashed filenames may use long-lived public caching with `immutable`.
- The application shell or HTML entry point should use revalidation rather than an indefinite immutable cache.
- Any future user-specific caching must include the verified identity in the cache key and define explicit invalidation rules before it is enabled.

## 7. Core Data Model

The current schema uses eight `STRICT` D1 tables:

- `users`
- `auth_identities`
- `categories`
- `payment_methods`
- `subscriptions`
- `renewal_email_deliveries`
- `fx_snapshot`
- `fx_rates`

External authentication identities are separate from stable application users. Every tenant-owned business table uses `user_id` as its boundary, while provider FX snapshots are deployment-shared reference data. Categories, payment methods, and subscriptions store a validated icon token or emoji symbol. Subscription lifecycle state is `active` or `cancelled`; `archived_at` is an independent visibility state. Pause periods, price history, and actual transactions remain out of scope.

The migration-ready DDL, indexes, constraints, normalization rules, and extension paths are defined in [Data Model](./data-model.md).

The provider-gated reminder implementation adds account and subscription preference
fields plus the `renewal_email_deliveries` table. Existing and migrated subscriptions
remain opted out. The delivery uniqueness key is the user, subscription, and billing
occurrence so changing lead days cannot send a second email for the same occurrence.

## 8. Money and Reporting Rules

Persisted subscription amounts use integer micro-units in their original currencies; API amounts and provider rates use canonical decimal strings. Reporting retains exact rational values through normalization, ECB cross-rate conversion, and aggregation, then rounds only at the response boundary. The Dashboard combines complete estimates into the user's reporting currency and retains exact original-currency breakdowns. Every combined value is labeled as an estimate and includes the FX source and rate date.

Exact formulas, rounding rules, recurrence semantics, and the required test matrix are defined in [Billing Rules](./billing-rules.md).

## 9. Date and Renewal Calculations

Billing dates are local calendar dates. The next occurrence is inclusive of local today and is always calculated from the original anchor. Monthly schedules support explicit calendar-day and end-of-month modes. February 29 yearly schedules clamp in non-leap years and return to February 29 in leap years.

`next_billing_on` is materialized for queries but remains server-derived. The complete specification is maintained in [Billing Rules](./billing-rules.md).

Reminder planning uses the recurrence rule rather than subtracting lead days only
from `next_billing_on`. For local planning date `D`, it tests whether
`D + effectiveDaysBefore` is an occurrence. This preserves correct behavior when the
lead time equals or exceeds a short recurrence interval.

## 10. Pages and User Flows

The MVP is a responsive website only; there are no native macOS or iOS clients. Its
Phase 5 route set includes Dashboard, Categories, Subscriptions, and Settings. It uses
sidebar navigation at wide browser widths and bottom navigation at narrow widths. The
visible English label for the Dashboard route is Overview. Its wide-browser view
leads with combined reporting-currency estimates and rate metadata, then preserves
the next charge, grouped renewal agenda, original-currency breakdown, and category
summary. The Categories route groups active subscriptions into information-dense,
image-free cards and reuses the filtered Subscriptions route for drill-down;
category CRUD remains in Settings. Category onboarding offers a reviewed preset
bundle; category and payment settings offer localized templates; all three resource
editors share an accessible common-icon and emoji picker. The wide-browser
Subscriptions route retains a responsive card grid with an optional compact list
view, search, sorting, and tenant-scoped filters.

The implemented Phase 4 follow-up makes those same category and payment-method
templates available directly from subscription Create and Edit. It also adds the
first mathematically consistent Bar and Donut views for estimated category and
payment-method composition and publishes the canonical self-hosting guide through
GitHub Pages without a custom documentation domain.

The provider-gated email follow-up added an explicit reminder toggle to Subscription
Create and Edit, an inherited-or-overridden lead time, a calculated reminder preview,
and account settings for the default lead time, local delivery time, and a global
pause. Phase 5 adds independent interface and email locales, removes non-actionable
unavailable-provider UI, simplifies resource creation copy, and renders Bar and Pie
charts separately. Neither phase infers opt-in from amount, currency, payment method,
or a manual-renewal label.

Responsive behavior, lifecycle actions, accessibility, localization, empty states, and acceptance flows are defined in [MVP UI Flow](./ui-flow.md).

## 11. API Contract

The API is a same-origin JSON API under `/api/v1`. It uses camelCase transport fields, decimal-string money, standard response envelopes, explicit lifecycle actions, and tenant-scoped `404` behavior. Import uses separate preview and confirmation requests.

Endpoints, payloads, errors, request limits, security headers, and contract tests are defined in [API Contract](./api-contract.md).

## 12. Migration from SubList

OpenSubLists uses a user-owned JSON archive. The runtime exports and imports schema V4
only. Legacy V1-to-V2, V2-to-V3, and V3-to-V4 changes use one-purpose offline
transformers rather than permanent runtime compatibility for old archive or database
shapes. Native SubList migration remains an adapter into the current archive model and
never writes directly to D1.

The archive schema, conflict strategies, security model, validation pipeline, and native mapping policy are defined in [Import and Export](./import-export.md).

## 13. Project Structure and Operations

The codebase separates domain, application, Worker infrastructure, API transport, and React UI. TypeScript is used across application layers; D1 schema and queries use explicit SQL. Local, preview, and production environments use isolated D1 databases.

Module boundaries and tool choices are defined in [Architecture and Technology Decisions](./architecture.md). Environment configuration, migrations, CI, deployment, recovery, and production checks are defined in [Environments and Deployment](./environments-and-deployment.md).

## 14. Delivery Phases

### Phase 0: Decisions and Specification — Complete

- [x] Confirm MVP fields and status semantics.
- [x] Define test cases for money, dates, and billing intervals.
- [x] Define the Access, session, caching, and tenant-isolation model.
- [x] Finalize the migration-ready data model and DDL proposal.
- [x] Define API, UI, import/export, environment, and deployment contracts.
- [x] Select consistent wide-browser visual targets for Dashboard and Subscriptions.

Completion criterion: No blocking ambiguity remains in the data model or critical business rules.

### Phase 1: Locally Usable Version — Complete

- [x] Create the Worker, React, and D1 project.
- [x] Implement database migrations and atomic per-user resource limits.
- [x] Add a loopback-only development identity and production Access JWT validation.
- [x] Implement subscription CRUD, lifecycle actions, categories, and payment methods.
- [x] Complete the responsive list, detail, and edit flows.
- [x] Implement the dashboard, JSON import/export, and per-currency reporting.
- [x] Add domain tests and Worker/D1 integration coverage.

Completion criterion: The maintainer can manage all subscriptions locally.

### Phase 2: Private Cloudflare Deployment — In Progress

- [x] Create the production D1 database and configure the production Worker, hostname, and binding metadata.
- [x] Configure Access OTP, the initial email allowlist, and the real production audience.
- [x] Apply production migrations and deploy the Worker to the configured production hostname.
- [x] Verify unauthenticated Access redirects and the absence of alternate Worker entry points.
- [x] Complete the authenticated OTP, JWT validation, and first-user provisioning smoke test.
- [ ] Complete a hosted subscription create, edit, archive, and unarchive smoke test.
- [ ] Add isolated preview D1, hostname, and Access resources before regular preview releases begin.
- [x] Prevent public entry points and accidental local-auth configuration from bypassing Access.
- [x] Add structured logging, stable error handling, and backup documentation.
- [x] Complete portable JSON import and export.

Completion criterion: The maintainer can use the application reliably, and accounts cannot access one another's data.

### Phase 3: Reporting, Presets, and Symbols Refactor — Complete

- [x] Approve estimated reporting semantics and explicitly reject an actual transaction ledger.
- [x] Select ECB daily reference rates and a one-Worker scheduled refresh design.
- [x] Define localized category and payment-method template catalogs.
- [x] Define common-icon and emoji storage, validation, rendering, and fallbacks.
- [x] Define the one-time legacy operator cutover and rollback path.
- [x] Implement the target schema, FX provider, scheduled refresh, Dashboard contract, presets, and symbols.
- [x] Rehearse the data cutover against temporary local and remote D1 databases.
- [x] Cut over production only after backup, review-table approval, and verification.

Completion criterion: The Dashboard provides complete reporting-currency estimates with visible rate metadata, presets create editable ordinary rows, symbols render safely, and the maintainer's original data is verified in the new schema.

The detailed implementation order and cutover gates are defined in [Reporting, Presets, and Symbols Refactor Plan](./reporting-presets-refactor-plan.md).

### Phase 4: Self-service Workflow and Friend Preview — Deployed

- [x] Add first-run setup guidance.
- [x] Expose existing, preset-created, and custom categories directly in subscription Create and Edit.
- [x] Expose existing, preset-created, and custom payment methods directly in subscription Create and Edit.
- [x] Correct the category breakdown metric and add accessible Bar and Donut views for category and payment-method estimates.
- [x] Publish the self-hosting guide from this repository through the default GitHub Pages project URL without a custom domain.
- [x] Provider-gated: add explicit per-subscription renewal email, D1 delivery
      idempotency and retries, persisted locale, an hourly Cron, and the Cloudflare email
      adapter. Production sender and recipient verification remain disabled operator
      configuration, not repository state.
- [x] Improve empty states, error messages, and mobile behavior.
- [ ] Obtain a redacted native SubList JSON sample.
- [x] Add versioned OpenSubLists JSON import.
- [ ] Add the native SubList migration adapter after receiving a redacted fixture.
- [ ] Invite a small group and collect feedback.

Completion criterion: A new user can record a first subscription without developer
guidance, and an operator can follow the public documentation from a clean clone to a
verified private deployment.

The provider-gated reminder subphase is complete when an opted-in subscription creates
one logical delivery row for a projected occurrence, provider results follow the
documented conservative retry/unknown policy, and local or CI runs cannot contact a
real mailbox.

The detailed delivery sequence and acceptance gates are defined in
[Subscription Editor, Email Reminders, GitHub Pages, and Dashboard Charts Plan](./subscription-editor-docs-and-charts-plan.md).

### Phase 5: UX Simplification, Locale Separation, Email Activation, and Charts — Implemented Locally; Rollout Gated

- [x] Separate Interface language and Email language without mismatch warnings or
      copy-language actions.
- [x] Replace user-facing preset terminology, sparse template walls, checkboxes, and
      ambiguous operations with compact Saved, Common, Create, and Add-and-select
      flows.
- [x] Add a top-level category overview with useful grouped subscription previews,
      image-free category identity, filtered-list drill-down, and separate Settings
      management.
- [x] Remove non-actionable provider notices and controls from ordinary Profile and
      Subscription screens.
- [x] Show separate Bar and Pie charts for category and payment-method estimates,
      including valid one-group data.
- [x] Migrate the repository contract to explicit interface and email fields, runtime
      archive V4, migration 0007, and a strict offline V3-to-V4 transformer.
- [x] Record an exact production recovery point, apply migration 0007 to the hosted
      D1 database, and verify unchanged tenant-row counts plus the locale backfill.
- [ ] Transform and review any retained private V3 archive before it is needed for a
      future import or transfer; never commit the source or transformed copy.
- [ ] Activate the existing native email adapter first for one verified operator
      destination, then for individually verified friend destinations.

Completion criterion: ordinary subscription organization no longer exposes preset
mechanics or dead controls; category browsing is informative and distinct from
management; the two locales are independent; all valid breakdowns show both requested
chart shapes; and the verified-destination email rollout passes the manual no-send and
operator-only delivery gates.

The implemented corrective behavior, rollout order, and acceptance criteria are defined
in [UX Simplification, Locale Separation, Email Activation, and Dashboard Charts Plan](./ux-simplification-locale-email-and-charts-plan.md).

### Phase 6: Demand-driven Enhancements

- Price history and pause periods.
- Actual transaction tracking only if the product stops being an estimate-only ledger.
- An iCalendar subscription feed.
- Installable PWA support.
- Optional public registration or in-app invitations.

## 15. Testing Priorities

- Monthly renewals anchored on January 29, 30, and 31.
- Yearly renewals anchored on February 29.
- Multi-unit intervals such as every three months or every two weeks.
- User time zones crossing calendar-day boundaries.
- Exclusion rules for cancelled and archived subscriptions.
- Money parsing, rounding, and formatting.
- Exact multi-currency conversion into one reporting currency without losing original-currency totals.
- Missing and stale FX behavior, one-snapshot consistency, and provider-failure fallback.
- Preset localization, symbol validation, and accessible icon/emoji selection.
- Reminder default versus override, short recurrences, local delivery dates, DST,
  lifecycle suppression, identity-email collisions, duplicate Cron runs, explicit
  provider outcomes, retries, import-time provider absence, and safe redacted logs.
- Cross-user access attempts on every resource endpoint.
- Repeated JSON imports and rollback after failed imports.

## 16. Observability and Backups

- Record structured request and error logs using registered route templates and stable
  codes, without Access JWTs, concrete resource paths, raw exception messages, full
  notes, or other sensitive content.
- Keep automatic invocation logs and traces disabled while Cloudflare includes full
  request URLs in those platform records; use explicitly sampled application logs.
- Return stable API error codes and readable messages.
- Make database migrations repeatable and validate them before deployment.
- Use D1 recovery as a baseline while still providing user-level JSON export.
- Track delivery results and retries if reminders are enabled.

## 17. Open Decisions

The following do not block the first hosted deployment:

1. A redacted native SubList JSON export is still required before its adapter can be finalized.
2. Whether a future arbitrary-recipient adapter should use Cloudflare Email Sending or
   another HTTP provider after the initial verified-destination rollout.
3. Whether the deferred 12-month projection should reuse Recharts or a smaller
   purpose-built visualization after real usage establishes its value.

## 18. Current Decisions

- The first version uses one full-stack Worker rather than splitting Workers by assumption.
- D1 is the primary database.
- Initial access is invite-only with no public registration.
- Cloudflare Access OTP is the preferred identity solution.
- Hosted users authenticate with email PINs; the application does not store passwords.
- The repository tracks a fail-closed `wrangler.example.jsonc`; each operator keeps real hosted resource values in ignored `wrangler.local.jsonc`.
- The project is licensed under the MIT License.
- TypeScript is the application language; D1 schema and queries use explicit SQL.
- The MVP uses React, Vite, Hono, Zod, Vitest, Wrangler, and pnpm without an ORM.
- The initial scaffold targets Node.js 24 LTS; exact dependency and package-manager versions are pinned in repository metadata.
- The Access global session duration is 30 days, and the application or policy session duration is 7 days.
- The Worker caches remote Access JWKS data but verifies every JWT locally on every request.
- Authorization decisions and authenticated API responses are not shared-cacheable; authenticated APIs default to `Cache-Control: private, no-store`.
- Only content-hashed static assets receive long-lived public caching.
- The MVP does not include image storage.
- The Dashboard combines complete estimates in the user's reporting currency with ECB daily reference rates and always retains original-currency totals.
- Combined values are estimates only; the product has no payment or transaction ledger.
- Category and payment-method presets are localized creation templates copied into ordinary tenant rows.
- Subscription Create and Edit expose those templates through explicit
  reusable-resource creation; preset keys never become subscription data.
- Categories, payment methods, and subscriptions may store an allow-listed common icon token or one emoji.
- The initial FX refresh runs as a Cron Trigger on the existing full-stack Worker and atomically replaces one last known-good snapshot in D1.
- Renewal email is an explicit per-subscription opt-in. The account default never
  enables it, and amount, currency, payment method, or manual-renewal heuristics do not
  affect eligibility.
- Renewal email always targets the current Cloudflare Access account email. The
  application has no editable recipient, alternate address, or per-subscription
  recipient override.
- The reminder scheduler uses an independent hourly Cron, authoritative
  recurrence projection, the current verified primary email, original-currency
  values, and a D1 delivery ledger unique per billing occurrence.
- The initial production email adapter targets Cloudflare's native `send_email`
  binding and verified destination addresses. Deployments without a configured sender
  expose the capability as unavailable to application logic; normal screens omit the
  resulting unusable controls and global warning. Ambiguous
  native-provider results become visible terminal `unknown` states rather than
  automatic retries, and Queue adoption remains evidence-driven.
- Money is stored as integer micro-units.
- Subscription lifecycle state is active or cancelled; archiving is independent and is the default removal action.
- Pause periods and price history are deferred to dedicated tables.
- The API base path is `/api/v1`.
- The Dashboard API returns projected occurrence records, not subscription rows, so short recurrence intervals are counted correctly.
- Dashboard charts visualize reporting-currency estimates only when conversion is
  complete, show separate Bar and Pie views including one-group data, and always
  retain an accessible original-currency disclosure.
- The public self-hosting guide is published from the same GitHub repository at the
  default GitHub Pages project URL with no `CNAME` or custom domain.
- The personal MVP caps each account at 50 subscriptions and dashboard occurrence expansion at a 30-day window.
- The product is one responsive website; native desktop and mobile clients are outside the MVP.
- Initial UI locales are English and Simplified Chinese.
- Interface language and renewal-email language are separate preferences. A
  difference between them is valid and never produces a warning.
- `Preset` remains an internal creation-template concept. User-facing copy
  names saved resources, common choices, creation, and the final add/select result.
- `/categories` is an image-free browsing route and category CRUD remains
  at `/settings/categories`; selecting a group reuses the existing Subscriptions
  category filter rather than adding a category-detail API.
- Bar and Pie estimates are separate simultaneous visualizations and both still render
  for a one-group breakdown.
- Date rules and tenant isolation require automated tests before substantial UI development.

## 19. Official References

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare Access One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Cloudflare Access Application Token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [ECB Data API](https://data.ecb.europa.eu/help/api/data)
- [ECB euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)

# OpenSubLists Product and Technical Plan

> Status: Pre-implementation plan  
> Last updated: 2026-08-23  
> Deployment target: Cloudflare  
> Current phase: Planning complete; ready for project scaffolding

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
5. **Progressive enhancement.** Complete tracking and reporting before adding email reminders, exchange rates, and advanced imports.
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
- Daily, weekly, monthly, and yearly billing intervals with interval multipliers.
- Next billing date calculation.
- Monthly average, annualized, category, and upcoming-charge summaries.
- Separate summaries for each currency.
- Default currency and time-zone settings.
- JSON import and export.
- Responsive layouts for mobile and desktop browsers.

### 3.2 Excluded from the MVP

- Public registration and an in-app invitation system.
- App Store or screenshot-based AI import.
- Image uploads, a subscription icon library, and category backgrounds.
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

The initial deployment uses one Worker. Static assets, the API, and optional scheduled handlers remain in one deployment unit. Scheduled work should move to a separate Worker only when permissions, execution time, deployment cadence, or fault isolation create a concrete need.

### 4.2 Components Not Needed Initially

- **Pages:** Worker Static Assets can serve the frontend.
- **KV:** Business data needs relational queries and transactional semantics; D1 is a better fit.
- **R2:** The MVP does not support image uploads.
- **Durable Objects:** There is no real-time collaboration or strong single-coordinator requirement.
- **Queues:** Scheduled work can run directly for a small user base. Add a queue when reliable retries or batch volume justify it.

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

The MVP uses five `STRICT` D1 tables:

- `users`
- `auth_identities`
- `categories`
- `payment_methods`
- `subscriptions`

External authentication identities are separate from stable application users. Every business table uses `user_id` as its tenant boundary, and tenant-owned relationships use composite foreign keys. Subscription lifecycle state is `active` or `cancelled`; `archived_at` is an independent visibility state. Pause periods and price history are deferred to dedicated future tables.

The migration-ready DDL, indexes, constraints, normalization rules, and extension paths are defined in [Data Model](./data-model.md).

## 8. Money and Reporting Rules

Persisted amounts use integer micro-units; API amounts use canonical decimal strings. Reporting retains exact rational values through aggregation and rounds only at the response boundary. Different currencies remain separate, and normalized monthly or annual values are labeled as estimates.

Exact formulas, rounding rules, recurrence semantics, and the required test matrix are defined in [Billing Rules](./billing-rules.md).

## 9. Date and Renewal Calculations

Billing dates are local calendar dates. The next occurrence is inclusive of local today and is always calculated from the original anchor. Monthly schedules support explicit calendar-day and end-of-month modes. February 29 yearly schedules clamp in non-leap years and return to February 29 in leap years.

`next_billing_on` is materialized for queries but remains server-derived. The complete specification is maintained in [Billing Rules](./billing-rules.md).

## 10. Pages and User Flows

The MVP includes Dashboard, Subscriptions, and Settings. It uses desktop sidebar navigation and mobile bottom navigation. The visible English label for the Dashboard route is Overview. Its desktop view prioritizes the next charge and a grouped 30-day renewal agenda, followed by separate per-currency estimates and a count-based category summary. The desktop Subscriptions route uses a responsive card grid by default with an optional compact list view, plus search, sorting, and tenant-scoped filters. Create and edit forms prioritize name, amount, frequency, and billing anchor while placing end-of-month behavior and notes behind progressive disclosure.

Responsive behavior, lifecycle actions, accessibility, localization, empty states, and acceptance flows are defined in [MVP UI Flow](./ui-flow.md).

## 11. API Contract

The API is a same-origin JSON API under `/api/v1`. It uses camelCase transport fields, decimal-string money, standard response envelopes, explicit lifecycle actions, and tenant-scoped `404` behavior. Import uses separate preview and confirmation requests.

Endpoints, payloads, errors, request limits, security headers, and contract tests are defined in [API Contract](./api-contract.md).

## 12. Migration from SubList

OpenSubLists uses a versioned, user-owned JSON archive. Native SubList migration is an adapter into that archive model and never writes directly to D1. Unsupported pause, price, offer, and image fields produce explicit warnings.

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
- [x] Select consistent desktop visual targets for Dashboard and Subscriptions.

Completion criterion: No blocking ambiguity remains in the data model or critical business rules.

### Phase 1: Locally Usable Version

- Create the Worker, React, and D1 project.
- Implement database migrations.
- Add a development identity provider and production Access JWT validation.
- Implement subscription CRUD, categories, and payment methods.
- Complete the responsive list and edit form.
- Implement the basic dashboard.

Completion criterion: The maintainer can manage all subscriptions locally.

### Phase 2: Private Cloudflare Deployment

- Deploy the Worker and D1 database.
- Configure Access OTP and the email allowlist.
- Prevent public entry points from bypassing Access.
- Add logging, error handling, and backup documentation.
- Complete JSON export.

Completion criterion: The maintainer can use the application reliably, and accounts cannot access one another's data.

### Phase 3: Friend Preview

- Add first-run guidance.
- Improve empty states, error messages, and mobile behavior.
- Obtain a redacted native SubList JSON sample.
- Add JSON import and SubList migration.
- Invite a small group and collect feedback.

Completion criterion: A new user can record their first subscription without developer guidance.

### Phase 4: Demand-driven Enhancements

- Email reminders.
- Daily exchange rates and default-currency estimates.
- Price history and pause periods.
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
- Prevention of accidental cross-currency totals.
- Cross-user access attempts on every resource endpoint.
- Repeated JSON imports and rollback after failed imports.

## 16. Observability and Backups

- Record structured error logs without Access JWTs, full notes, or other sensitive content.
- Return stable API error codes and readable messages.
- Make database migrations repeatable and validate them before deployment.
- Use D1 recovery as a baseline while still providing user-level JSON export.
- Track delivery results and retries if reminders are enabled.

## 17. Open Decisions

The following do not block the initial project scaffold:

1. A redacted native SubList JSON export is still required before its adapter can be finalized.
2. The first reminder channel remains deferred until reminders enter the approved scope.
3. Exchange-rate provider selection remains deferred until currency conversion enters the approved scope.

## 18. Current Decisions

- The first version uses one full-stack Worker rather than splitting Workers by assumption.
- D1 is the primary database.
- Initial access is invite-only with no public registration.
- Cloudflare Access OTP is the preferred identity solution.
- TypeScript is the application language; D1 schema and queries use explicit SQL.
- The MVP uses React, Vite, Hono, Zod, Vitest, Wrangler, and pnpm without an ORM.
- The initial scaffold targets Node.js 24 LTS; exact dependency and package-manager versions are pinned in repository metadata.
- The Access global session duration is 30 days, and the application or policy session duration is 7 days.
- The Worker caches remote Access JWKS data but verifies every JWT locally on every request.
- Authorization decisions and authenticated API responses are not shared-cacheable; authenticated APIs default to `Cache-Control: private, no-store`.
- Only content-hashed static assets receive long-lived public caching.
- The MVP does not include image storage.
- The MVP does not force cross-currency totals.
- Money is stored as integer micro-units.
- Subscription lifecycle state is active or cancelled; archiving is independent and is the default removal action.
- Pause periods and price history are deferred to dedicated tables.
- The API base path is `/api/v1`.
- The Dashboard API returns projected occurrence records, not subscription rows, so short recurrence intervals are counted correctly.
- Initial UI locales are English and Simplified Chinese.
- Date rules and tenant isolation require automated tests before substantial UI development.

## 19. Official References

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare Access One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Cloudflare Access Application Token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)

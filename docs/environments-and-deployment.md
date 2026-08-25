# OpenSubLists Environments and Deployment

> Status: Implemented operations baseline and provider-gated renewal-email runtime;
> production email activation remains an operator action
> Last updated: 2026-08-24
> Deployment platform: Cloudflare

## 1. Environments

The project uses three isolated environments.

| Environment | Purpose                              | Worker                 | D1                     | Authentication                   |
| ----------- | ------------------------------------ | ---------------------- | ---------------------- | -------------------------------- |
| Local       | Development and tests                | Local Wrangler runtime | Local D1 files         | Fixed local development identity |
| Preview     | Integration and release verification | Preview Worker         | Preview D1 database    | Cloudflare Access OTP            |
| Production  | Real user data                       | Production Worker      | Production D1 database | Cloudflare Access OTP            |

Preview and production never share a D1 database, Access application audience, route, or secrets.

### 1.1 Operator-owned Hosted Targets

The repository does not record a maintainer's active hostname, D1 UUID, Access team
domain, or Access application audience. `wrangler.example.jsonc` documents the
required shape with fail-closed example values. Each operator copies it to the
ignored `wrangler.local.jsonc` file and supplies resources from their own Cloudflare
account.

Allowlisted email addresses live only in Cloudflare Access. They are operational
authorization data and are never stored in Git.

## 2. Wrangler Configuration

The tracked `wrangler.example.jsonc` contains explicit local, preview, and production
sections. Hosted migration and deployment scripts load the ignored
`wrangler.local.jsonc`; local development, tests, generated types, and CI load the
tracked example. Bindings retain the same logical names while pointing to different
resources.

Required bindings and variables:

| Name            | Kind           | Purpose                             |
| --------------- | -------------- | ----------------------------------- |
| `DB`            | D1 binding     | Environment-specific database       |
| `ENVIRONMENT`   | Plain variable | `local`, `preview`, or `production` |
| `PUBLIC_ORIGIN` | Plain variable | Exact allowed browser origin        |
| `TEAM_DOMAIN`   | Plain variable | Cloudflare Access team domain       |
| `POLICY_AUD`    | Plain variable | Access application audience         |

Optional reminder configuration:

| Name                                      | Kind                 | Purpose                                        |
| ----------------------------------------- | -------------------- | ---------------------------------------------- |
| `EMAIL`                                   | `send_email` binding | Native production transport                    |
| `EMAIL_REMINDER_MODE`                     | Plain variable       | `disabled`, `fake`, or production `cloudflare` |
| `EMAIL_REMINDER_FROM`                     | Plain variable       | Verified production sender address             |
| `EMAIL_REMINDER_PROVIDER_CONFIG_REVISION` | Plain variable       | Positive operator-controlled config version    |

Provider-gated email configuration optionally adds an `EMAIL` `send_email` binding,
sets `EMAIL_REMINDER_MODE=cloudflare`, and supplies the private
`EMAIL_REMINDER_FROM` deployment value for the native Cloudflare adapter. It also uses
the operator-controlled `EMAIL_REMINDER_PROVIDER_CONFIG_REVISION` value, which must
change whenever the binding, sender identity, or recipient policy changes; safe
retries compare the frozen revision before dispatch. The tracked example contains only
obvious placeholder shapes. Actual sender domains, revision values, and recipient
restrictions belong in ignored `wrangler.local.jsonc`. A future external HTTP provider
uses an encrypted Worker secret rather than a plain variable. The message-template
version is a source-code constant rather than deployment configuration.

## 3. Local Authentication

Local development must not depend on Cloudflare Access.

The complete website runs locally through the Cloudflare Vite plugin. The browser UI, Worker API, and D1 emulator share one origin and one persistent `.wrangler/state` directory. `pnpm dev` first runs `pnpm db:migrate:local`, so the local schema is always advanced by the same numbered migrations used remotely.

Both `pnpm dev` and `pnpm preview` bind only to `http://localhost:5173`. This keeps the fixed development identity on a loopback-only origin while supporting a production-shaped local build.

The local auth adapter returns a fixed identity configured through local-only values:

```text
provider: local_development
subject: local-user
email: developer@localhost.invalid
```

Safety requirements:

- Local auth is enabled only when `ENVIRONMENT=local`.
- The local server must bind to a loopback interface by default.
- Preview and production fail startup or fail requests closed if local auth configuration is detected.
- Production code contains no request header that can select or impersonate an arbitrary user.
- Multi-user authorization tests inject an authentication context through the test harness rather than a deployed HTTP backdoor.

Normal local workflow:

```text
corepack enable
pnpm install
pnpm dev
```

No Cloudflare account, remote D1 database, or Access configuration is required for this workflow.

## 4. Cloudflare Access Configuration

Preview and production each have a self-hosted Access application.

Required settings:

- One-time PIN identity provider.
- Explicit email allowlist policy.
- Global session duration: 30 days.
- Application or policy session duration: 7 days.
- Separate audience tag for preview and production.
- Production hostname covered by Access before user traffic is enabled.

Hosted users do not have OpenSubLists passwords. Cloudflare sends a single-use PIN
only to an email address that matches the Access allowlist. To invite or remove a
friend, update the Access policy; no application database or password reset is
required.

After renewal email is enabled, Access removal alone does not stop scheduled messages
because the application retains the last verified primary email. The operator must
also pause that user's reminders or remove/suppress the destination at the email
provider before removing access.

A verified-email ownership collision sets a system-owned reminder suspension and
fails identity resolution. User settings cannot clear it. The implemented operator
command rechecks uniqueness and clears only the matching suspension by internal user ID
after the underlying Access/application identity conflict is resolved. It also pauses
all reminders, increments the account reminder revision, and cancels stale unattempted
deliveries. The user must then sign in so the Worker refreshes the verified primary
email and explicitly unpause reminders. Production use requires a D1 recovery point and
an explicit confirmation. Run it only from a trusted operator shell:

```sh
node tools/reminders/clear-identity-suspension.mjs \
  --user-id 00000000-0000-0000-0000-000000000000 \
  --confirm-user-id 00000000-0000-0000-0000-000000000000 \
  --database DB --config wrangler.local.jsonc \
  --remote --env production
```

`TEAM_DOMAIN` is the bare hostname returned by Cloudflare, without `https://`. The
Worker constructs the issuer URL and JWKS URL from that hostname. `POLICY_AUD` is the
exact audience returned by the hostname's Access application.

The Worker still validates `Cf-Access-Jwt-Assertion` even though Access is placed in front of it.

## 5. Public Routes and Bypass Prevention

- Production uses a custom hostname protected by Access.
- Disable the production `workers.dev` route with `workers_dev: false` unless it is independently protected.
- Preview must also avoid an unprotected alternate route.
- API and static application routes share the protected origin.
- Health endpoints must not expose database, identity, or environment details.

The public self-hosting documentation site is implemented for the repository's default
GitHub Pages project URL and a separate deployment. It never requires exceptions
inside the protected application or publishes application configuration.

## 6. Database Lifecycle

### 6.1 Database Separation

- Local D1 data is disposable and ignored by Git.
- Preview D1 contains synthetic or explicitly approved test data only.
- Production D1 contains real user data.
- Production data is never copied to preview by default.

### 6.2 Migrations

Migration files are numbered and immutable after deployment:

```text
migrations/
  0001_initial.sql
  0002_resource_limits.sql
  0003_reduce_subscription_limit.sql
  0004_reporting_presets_symbols.sql
  0005_renewal_email_reminders.sql
  0006_resource_revisions.sql
```

Migration workflow:

1. Create a new migration file.
2. Apply it to a fresh local D1 database.
3. Apply all migrations to an existing local fixture database.
4. Run schema, integration, and tenant-isolation tests.
5. Apply to preview.
6. Verify preview application behavior and query plans.
7. Confirm production recovery readiness.
8. Apply to production before deploying code that requires the new schema, or use an expand-and-contract sequence.

Never edit a migration that has reached preview or production.

### 6.3 Compatible Schema Changes

Prefer expand-and-contract changes:

1. Add nullable columns or new tables.
2. Deploy code that can read old and new shapes.
3. Backfill if necessary.
4. Switch reads to the new shape.
5. Remove obsolete columns in a later migration.

The legacy v1-to-v2 reporting and symbols cutover is an explicit exception. It uses a
short write freeze, immutable JSON and D1 backups, an offline deterministic transform,
a fresh target D1 database, and a coordinated Worker binding switch. The previous
Worker and previous database remain paired for rollback; old and new application
schemas do not require dual-read interoperability. Full procedure and verification
gates are defined in [Reporting, Presets, and Symbols Refactor Plan](./reporting-presets-refactor-plan.md).

## 7. Seed Data

- Seed scripts run only in local development.
- Fixtures use clearly fictional users, subscriptions, and payment labels.
- Preview test data is created through normal APIs where possible.
- Production has no automatic seed beyond first-login user provisioning.
- Preset catalogs are bundled localized templates, not seed rows. Production categories and payment methods are created only after explicit user action or a reviewed legacy operator cutover.

## 8. CI Quality Gates

Every pull request must run:

1. Dependency installation from the lockfile.
2. Wrangler type generation consistency check.
3. Formatting check.
4. Lint.
5. Type checking.
6. Domain unit tests.
7. D1 schema and repository integration tests.
8. Tenant-isolation API tests.
9. Production build.
10. Public documentation-site build, inclusion, base-path, and artifact validation.

Critical end-to-end browser tests may run on merge or against preview if their runtime cost is higher.

## 9. Deployment Workflow

Initial deployments are manually promoted:

```text
main branch
   ↓
CI passes
   ↓
Deploy preview
   ↓
Preview smoke test
   ↓
Apply production migration if needed
   ↓
Deploy production Worker
   ↓
Production smoke test
```

Automatic production deployment is deferred until the release process is stable.

An initial operator release may deploy directly to an already protected
production hostname after all local gates pass. Before subsequent feature releases,
provision the isolated preview environment and resume the normal preview-first flow.

### 9.1 GitHub Pages Documentation Deployment — Implemented Locally, Publication Pending

The public documentation site has a dedicated GitHub Actions workflow. It builds
VitePress from the repository's `site/` directory, uploads only the generated static
output, and deploys through the `github-pages` environment after a push to `main` or a
manual dispatch. Pull requests build and validate the site through normal CI but never
deploy it.

This workflow is operationally independent from preview and production Workers. It has
no Cloudflare credentials, cannot migrate D1, and cannot change the
protected application. The detailed implementation and artifact-security gates are
defined in
[Subscription Editor, Email Reminders, GitHub Pages, and Dashboard Charts Plan](./subscription-editor-docs-and-charts-plan.md).

The repository owner must still select GitHub Actions as the Pages publishing source
and complete the first successful workflow run. Local implementation must not be
recorded as a live publication until the default project URL has been verified.

## 10. Release Smoke Tests

Preview and production smoke tests verify:

- Access redirects an unauthenticated browser.
- An approved user can sign in.
- `/api/v1/me` returns the expected current user.
- Subscription list, create, edit, archive, and unarchive work.
- Another test identity cannot access the first identity's resources in preview.
- API responses include `Cache-Control: private, no-store`.
- Hashed static assets return long-lived cache headers.
- Static page and asset responses deny framing, disable MIME sniffing, and send no
  referrer information.
- The Worker cannot be reached through an unprotected alternate route.
- The FX snapshot has the expected ECB source, reference date, and complete coverage for every active subscription currency.
- Reporting-currency estimates and original-currency totals pass a reviewed fixture calculation.

Production smoke tests must avoid creating realistic sensitive data. Any created test record is removed immediately.

## 11. Observability

Enable sampled application logs for preview and production. The initial private
deployment retains all application log events (`head_sampling_rate: 1`); lower this
rate only if measured traffic justifies it.

Minimum structured fields:

- Timestamp.
- Environment.
- Request ID.
- Route template and method.
- HTTP status.
- Duration.
- Application error code.
- Scheduled-job name when applicable.

Do not log JWTs, cookies, request bodies, notes, payment labels, or import contents.

Cloudflare invocation logs are disabled because their built-in fetch record includes
the full request URL. Automatic Workers traces are also disabled because their fetch
spans currently include `url.full`, `url.path`, and `url.query`. Those platform streams
must remain disabled until Cloudflare provides a redaction control that preserves this
project's route-template-only privacy boundary. The application-owned completion and
failure records provide request timing, status, and stable error codes without concrete
resource identifiers.

Initial operational alerts may be manual dashboard checks. Add automated alerting when real usage justifies it.

## 12. Backups and Recovery

- D1 Time Travel is the platform-level recovery mechanism.
- User-level JSON export is the portability and self-service backup mechanism.
- Before a risky production migration, confirm the available D1 recovery point or bookmark.
- Before a legacy v1-to-v2 cutover, preserve the raw archive, D1 SQL backup, transformed archive, hashes, and verification report as separate artifacts.
- Recovery exercises should be tested against preview before relying on them for production.
- Application code must tolerate a rollback to the previous Worker version when the schema remains in an expanded compatible state.

## 13. Rollback Strategy

### Code-only Failure

Roll back to the previous Worker deployment.

### Compatible Schema Failure

Roll back code while leaving additive schema changes in place. Follow up with a corrective migration.

### Destructive Data Failure

Stop writes, assess the affected interval, and use D1 recovery tooling. Do not attempt ad hoc mass repair before preserving the incident state.

Database migrations are normally forward-fixed rather than reversed.

### Legacy Refactor Cutover Failure

Restore the previous Worker deployment and its previous D1 binding together. Do not
point old code at the new schema or new code at the old schema. Keep both databases
until the operator explicitly accepts the cutover.

## 14. Secrets and Permissions

- Store secrets only with Cloudflare secret bindings.
- Keep preview and production secrets separate.
- Use the narrowest practical Cloudflare API token permissions in CI.
- Database IDs, Access audience values, team domains, and public hostnames are not credentials, but they are operator-owned deployment metadata and do not belong in this repository. Keep them in ignored `wrangler.local.jsonc` and back that file up privately.
- Never commit account API tokens, Access JWTs, session cookies, approved email addresses, or other authorization credentials.
- Never place JWTs or API tokens in URLs.

## 15. Scheduled Work

The existing full-stack Worker owns a daily ECB rate-refresh `scheduled()` handler.
Production configures `15 18 * * *`; Cloudflare Cron expressions run in UTC.

- Validate a complete provider response before atomically replacing the singleton D1 snapshot.
- Preserve the last known-good snapshot on network, parsing, validation, or write failure.
- Make provider/date refresh idempotent.
- Test the scheduled handler through the Cloudflare Vite local scheduled route.
- Split background work only if execution or permission boundaries justify it.
- `5 * * * *` runs renewal-email planning and delivery. Dispatch by
  the exact `controller.cron` value so the hourly trigger does not refresh ECB and the
  daily trigger does not scan reminder deliveries.
- Convert each user's configured local delivery time into one UTC intent and use the
  recurrence rule to test the target billing occurrence; do not use
  `next_billing_on - leadDays` as the only selector.
- Use D1 as the bounded durable delivery outbox and retry ledger. Keep Cloudflare
  Queues deferred until measured volume, retry latency, or execution limits justify it.
- Treat D1 uniqueness as one logical delivery row, not exactly-once physical email.
  The native binding has no documented idempotency input, so ambiguous results and
  expired `sending` leases become terminal `unknown`; only a result that proves
  non-acceptance is retried.
- Local and CI use an injected fake email sender. Exercise the hourly path through the
  Cloudflare Vite scheduled route with explicit `cron` and `time` parameters.
- Preview either uses the fake sender or a strict operator-only destination. Production
  rollout verifies one operator destination before any friend reminder is enabled.
- When no sender is configured, expose `capabilities.emailReminders = false`, perform
  no delivery call, and leave the rest of the application operational.

## 16. Production Readiness Checklist

This is an operator checklist rather than a record of any specific deployment.

- [ ] Production D1 created and bound only to production.
- [ ] Preview D1 created and isolated.
- [x] All migrations pass fresh and upgrade-path tests locally.
- [ ] All production migrations applied remotely.
- [ ] Access OTP and initial allowlist configured.
- [ ] Session durations configured to 30 days global and 7 days application/policy.
- [ ] Access JWT issuer and audience values configured in `wrangler.local.jsonc`.
- [x] Unprotected `workers.dev` and version preview routes disabled in configuration.
- [x] Same-origin checks enabled on unsafe API methods.
- [ ] API cache policy verified.
- [ ] Logging redaction verified.
- [ ] JSON export tested.
- [ ] D1 recovery process reviewed.
- [ ] Daily Cron Trigger deployed and visible in Worker configuration.
- [ ] Initial ECB snapshot populated and complete for active currencies.
- [ ] Reporting estimates verified against an independent fixture.
- [ ] Preview smoke tests passed.

Phase 4 provider-gated reminder readiness:

- [ ] Reminder migration applied with existing subscriptions disabled.
- [ ] Native email binding or reviewed external provider configured only in the target
      environment.
- [ ] Sender domain and initial operator destination verified.
- [ ] Hourly Cron deployed and independently dispatched from the daily FX Cron.
- [ ] Fake-sender local tests and operator-only preview tests passed.
- [ ] A no-send scheduled scan completed before the first operator reminder was enabled.
- [ ] One operator reminder delivered, retry state inspected, and logs verified to
      contain no recipient or message content.
- [ ] Disabling the Cron or provider capability was rehearsed as the reminder rollback.

### 16.1 Operator Release Records

An operator may keep Worker version IDs, D1 recovery bookmarks, smoke-test results,
and incident notes in a private operations system. Do not add active resource IDs,
approved identities, or user data to this public repository.

## 17. Official References

- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Validating Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [ECB Data API](https://data.ecb.europa.eu/help/api/data)
- [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare email send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Cloudflare Email Routing subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)

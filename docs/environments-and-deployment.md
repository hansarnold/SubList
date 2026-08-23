# OpenSubLists Environments and Deployment

> Status: MVP operations plan  
> Last updated: 2026-08-23  
> Deployment platform: Cloudflare

## 1. Environments

The project uses three isolated environments.

| Environment | Purpose                              | Worker                 | D1                     | Authentication                   |
| ----------- | ------------------------------------ | ---------------------- | ---------------------- | -------------------------------- |
| Local       | Development and tests                | Local Wrangler runtime | Local D1 files         | Fixed local development identity |
| Preview     | Integration and release verification | Preview Worker         | Preview D1 database    | Cloudflare Access OTP            |
| Production  | Real user data                       | Production Worker      | Production D1 database | Cloudflare Access OTP            |

Preview and production never share a D1 database, Access application audience, route, or secrets.

## 2. Wrangler Configuration

Use one `wrangler.jsonc` with explicit environment sections. Bindings retain the same logical names while pointing to different resources.

Required bindings and variables:

| Name            | Kind           | Purpose                             |
| --------------- | -------------- | ----------------------------------- |
| `DB`            | D1 binding     | Environment-specific database       |
| `ENVIRONMENT`   | Plain variable | `local`, `preview`, or `production` |
| `PUBLIC_ORIGIN` | Plain variable | Exact allowed browser origin        |
| `TEAM_DOMAIN`   | Plain variable | Cloudflare Access team domain       |
| `POLICY_AUD`    | Plain variable | Access application audience         |

Future email provider keys and import-signing secrets, if any, use encrypted Worker secrets rather than plain variables.

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

The Worker still validates `Cf-Access-Jwt-Assertion` even though Access is placed in front of it.

## 5. Public Routes and Bypass Prevention

- Production uses a custom hostname protected by Access.
- Disable the production `workers.dev` route with `workers_dev: false` unless it is independently protected.
- Preview must also avoid an unprotected alternate route.
- API and static application routes share the protected origin.
- Health endpoints must not expose database, identity, or environment details.

A public static marketing site, if ever added, should use a separate hostname or deployment rather than exceptions inside the protected application.

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

## 7. Seed Data

- Seed scripts run only in local development.
- Fixtures use clearly fictional users, subscriptions, and payment labels.
- Preview test data is created through normal APIs where possible.
- Production has no automatic seed beyond first-login user provisioning.

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

## 10. Release Smoke Tests

Preview and production smoke tests verify:

- Access redirects an unauthenticated browser.
- An approved user can sign in.
- `/api/v1/me` returns the expected current user.
- Subscription list, create, edit, archive, and unarchive work.
- Another test identity cannot access the first identity's resources in preview.
- API responses include `Cache-Control: private, no-store`.
- Hashed static assets return long-lived cache headers.
- The Worker cannot be reached through an unprotected alternate route.

Production smoke tests must avoid creating realistic sensitive data. Any created test record is removed immediately.

## 11. Observability

Enable Workers logs for preview and production.

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

Initial operational alerts may be manual dashboard checks. Add automated alerting when real usage justifies it.

## 12. Backups and Recovery

- D1 Time Travel is the platform-level recovery mechanism.
- User-level JSON export is the portability and self-service backup mechanism.
- Before a risky production migration, confirm the available D1 recovery point or bookmark.
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

## 14. Secrets and Permissions

- Store secrets only with Cloudflare secret bindings.
- Keep preview and production secrets separate.
- Use the narrowest practical Cloudflare API token permissions in CI.
- Do not commit account IDs, database IDs, audience values, or team domains if the repository is intended to be reusable without exposing deployment metadata; provide an example configuration instead.
- Never place JWTs or API tokens in URLs.

## 15. Scheduled Work

The MVP does not require a Cron Trigger. Upcoming charges are calculated during reads.

When reminders or exchange-rate refreshes are approved:

- Add a `scheduled()` handler to the existing Worker first.
- Cron expressions run in UTC.
- Convert reminder delivery intent from the user's time zone to an execution window.
- Make all jobs idempotent.
- Split background work only if execution or permission boundaries justify it.

## 16. Production Readiness Checklist

- [ ] Production D1 created and bound only to production.
- [ ] Preview D1 created and isolated.
- [ ] All migrations pass fresh and upgrade-path tests.
- [ ] Access OTP and allowlist configured.
- [ ] Session durations configured to 30 days global and 7 days application/policy.
- [ ] Access JWT issuer and audience validation enabled.
- [ ] Unprotected alternate Worker routes disabled.
- [ ] Same-origin checks enabled on unsafe API methods.
- [ ] API cache policy verified.
- [ ] Logging redaction verified.
- [ ] JSON export tested.
- [ ] D1 recovery process reviewed.
- [ ] Preview smoke tests passed.

## 17. Official References

- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Validating Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

# Self-host OpenSubLists on Cloudflare

> Status: Supported manual deployment path; canonical documentation site published
>
> Last updated: 2026-08-25
>
> Expected cost for the implemented personal deployment: Cloudflare Free plan limits

This guide creates one full-stack Worker, one D1 database, one custom hostname, and
one hostname-scoped Cloudflare Access application. The public documentation site is a
separate GitHub Pages deployment. It never hosts the authenticated application, API,
or database.

The repository contains examples and placeholders only. It never needs an API token,
Access JWT, approved email address, operator hostname, or operator-owned resource ID.

## 1. Understand what gets deployed

The supported personal deployment has these parts:

| Part               | Purpose                                             | Location                       |
| ------------------ | --------------------------------------------------- | ------------------------------ |
| Full-stack Worker  | Responsive website, API, and scheduled handlers     | Cloudflare                     |
| D1 database        | Users, subscriptions, resources, and reporting data | Cloudflare                     |
| Cloudflare Access  | Invite-only one-time-PIN authentication             | Cloudflare                     |
| Custom hostname    | The private application URL                         | Operator-owned Cloudflare zone |
| Documentation site | This public guide only                              | GitHub Pages                   |

The core Worker, D1, Access, and default GitHub Pages project site can fit the
providers' free plans for a small personal installation when usage stays within their
current limits. Cloudflare does not need a paid email-sending plan for the core ledger.
The optional reminder path has its own verified-recipient and paid-recipient boundary;
review it separately before enabling email.

Provider limits and pricing can change. Review the current Cloudflare and GitHub plan
pages before inviting more users or enabling a paid capability.

## 2. Prerequisites

- A GitHub account for forking the repository.
- Node.js 24 and Corepack.
- A Cloudflare account.
- An active Cloudflare DNS zone in that account.
- An unused hostname such as `sublist.example.com` with no conflicting CNAME.
- Permission to create Workers, D1 databases, and Cloudflare Access applications.

## 3. Fork, clone, and install

Fork `hansarnold/SubList` in GitHub, then clone your fork. Replace
`YOUR_GITHUB_ACCOUNT` with your GitHub account name:

```sh
git clone https://github.com/YOUR_GITHUB_ACCOUNT/SubList.git
cd SubList
git remote add upstream https://github.com/hansarnold/SubList.git
corepack enable
pnpm install --frozen-lockfile
```

Keeping an `upstream` remote makes later updates explicit while your fork remains the
deployment source.

<a id="run-locally-first"></a>

## 4. Run locally first

Start the complete local application before provisioning anything remotely:

```sh
pnpm dev
```

Open `http://localhost:5173`. Local development uses the tracked example
configuration, a fixed loopback-only identity, and persistent local D1 state under
`.wrangler/state`. It does not require Cloudflare Access or a remote D1 database.

To test the current scheduled handler against local D1, keep the development server
running and use the Cloudflare Vite scheduled route:

```sh
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=15+18+*+*+*&format=json"
```

This local request does not touch production. It should return a successful structured
outcome and write an FX snapshot to local D1.

The documentation site also runs independently:

```sh
pnpm docs:dev
```

Open `http://127.0.0.1:5174/SubList/` for the documentation development server.

## 5. Create the private operator configuration

Copy the tracked example rather than editing it:

```sh
cp wrangler.example.jsonc wrangler.local.jsonc
```

`wrangler.local.jsonc` is ignored by Git and is used only by hosted migration, build,
and deployment commands. Keep the binding names `DB`, `ENVIRONMENT`,
`PUBLIC_ORIGIN`, `TEAM_DOMAIN`, and `POLICY_AUD` unchanged.

Authenticate Wrangler:

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Never commit the authenticated configuration or paste its private values into an
issue, Actions log, or documentation page.

## 6. Create the production D1 database

Create an operator-owned database:

```sh
pnpm exec wrangler d1 create open-sublists-production --config wrangler.local.jsonc
```

If Wrangler offers to edit the configuration automatically, decline and update only
the `env.production.d1_databases` entry manually. Record the returned database name
and UUID in `wrangler.local.jsonc`:

```jsonc
"database_name": "open-sublists-production",
"database_id": "00000000-0000-0000-0000-000000000000"
```

The zero UUID is a fail-closed example. Replace it with the UUID returned for your
database. Use a separate D1 database if a preview environment is enabled later.

## 7. Configure Cloudflare Access

Configure Access before exposing the Worker hostname:

1. In Cloudflare Zero Trust, choose or create the account team domain.
2. Under **Integrations > Identity providers**, add **One-time PIN**.
3. Under **Access controls > Applications**, add a **Self-hosted** application.
4. Enter the exact production hostname, such as `sublist.example.com`.
5. Add an **Allow** policy whose selector is **Emails** and list each approved email.
6. Do not use `Login Methods = One-time PIN` as the only Allow rule. That rule would
   allow any address capable of completing an OTP login.
7. Copy the application audience from **Additional settings > Application Audience
   (AUD) Tag**.

The hosted Worker validates the Access JWT itself. It therefore needs both the bare
team hostname and the exact application audience. OpenSubLists stores no password.

## 8. Complete the production configuration

Replace every production example in `wrangler.local.jsonc`:

| Field                 | Example                                   | Required form                                 |
| --------------------- | ----------------------------------------- | --------------------------------------------- |
| `env.production.name` | `open-sublists-production`                | A Worker name unique in the account           |
| `routes[0].pattern`   | `sublist.example.com`                     | Hostname only, without a scheme or path       |
| `PUBLIC_ORIGIN`       | `https://sublist.example.com`             | Exact HTTPS origin, without a trailing slash  |
| `TEAM_DOMAIN`         | `example.cloudflareaccess.com`            | Bare Access team hostname, without `https://` |
| `POLICY_AUD`          | `replace-with-production-access-audience` | Exact Access application AUD tag              |
| `database_name`       | `open-sublists-production`                | D1 database name returned by Wrangler         |
| `database_id`         | zero UUID                                 | D1 database UUID returned by Wrangler         |

Do not enable `workers.dev` or version preview URLs unless those alternate hostnames
are independently protected by Access.

## 9. Validate and deploy

Run all local quality gates, build the public guide, and validate the real production
configuration:

```sh
pnpm check
pnpm docs:build
pnpm deploy:dry-run:production
```

Apply migrations before deploying code that depends on them:

```sh
pnpm db:migrate:production
pnpm deploy:production
```

The custom-domain deployment creates the DNS record and certificate. It will fail if
the hostname belongs to another Cloudflare account or already has a conflicting
CNAME.

Cron changes may take several minutes to propagate. The application intentionally has
no public production endpoint that impersonates a scheduled event. For a new database,
opening the Dashboard with a subscription that needs currency conversion performs one
initial FX refresh if no snapshot exists. Then verify that the next configured daily
Cron run records `fx_refresh_complete` in privacy-safe Worker logs.

## 10. Verify the deployment

Verify all of the following before entering real subscription data:

- An unauthenticated request is redirected to Cloudflare Access.
- Only an explicitly allowlisted address receives access after OTP authentication.
- `GET /api/v1/me` returns the expected current user.
- Subscription create, edit, archive, and unarchive operations succeed.
- The Dashboard shows estimates and retains original-currency totals.
- An initial FX snapshot exists when mixed-currency reporting requires one.
- API responses use `Cache-Control: private, no-store`.
- The Worker cannot be reached through `workers.dev` or a version preview URL.
- JSON export downloads a portable archive.

## 11. Invite or remove a user

OpenSubLists has no application invitation table. Add or remove email addresses in the
Cloudflare Access policy. Each authenticated identity is provisioned as an isolated
application user on first access.

When renewal email is enabled, removing Access is only one part of
offboarding. Pause that account's reminders or suppress/remove its destination at the
email provider before removing the person's ability to sign in.

The reminder phase also ships an operator-only suspension-clear command for an
`identity_email_conflict`. It accepts an internal user ID, requires explicit
confirmation, rechecks that the normalized email is no longer owned by another user,
and clears only the matching system suspension. It never accepts or prints an email
address. Back up D1 first; do not clear the reason with ad hoc SQL or through the
user-facing `/me` endpoint.

## 12. Update, back up, restore, or roll back

Pull from the upstream repository into a reviewed branch. Do not deploy an unreviewed
upstream change directly to production:

```sh
git fetch upstream
git switch -c update-open-sublists
git merge --ff-only upstream/main
pnpm install --frozen-lockfile
pnpm check
pnpm docs:build
pnpm deploy:dry-run:production
```

Before applying a production migration, create an application JSON export and confirm
that D1 Time Travel covers the database. Then apply pending migrations and deploy:

```sh
pnpm db:migrate:production
pnpm deploy:production
```

Use Cloudflare's Worker deployment history to roll application code back. Migrations
are forward-only; do not edit a migration that reached production. Restore D1 from a
reviewed Time Travel point only when a database rollback is explicitly required.

Never copy an operator's production D1 database into preview by default. Keep private
recovery bookmarks, exports, IDs, and verification records outside this repository.

## 13. Public documentation site

The repository includes a VitePress site that renders this canonical file rather than
maintaining a second copy of the deployment steps. It is configured for the default
project URL:

```text
https://hansarnold.github.io/SubList/
```

The site is public static documentation only. It does not replace the Worker, D1,
Cloudflare Access, or the operator-controlled application hostname. It has no custom
domain, `CNAME`, DNS change, Cloudflare credential, or access to operator configuration.

The Pages workflow is deliberately independent from Worker deployment. Pull requests
and normal CI run `pnpm docs:build` without publishing. A push to `main` or a manual
workflow run may deploy only after the repository owner selects **GitHub Actions**
under **Settings > Pages > Build and deployment > Source**.

The canonical Pages project is published. After documentation changes, verify the root
page, a direct reload of `/SubList/guide/self-hosting.html`, anchors, local search,
edit links, and the absence of a custom domain. The checked-in site configuration and
privacy validator are pinned to this repository's canonical
`hansarnold.github.io/SubList/` documentation URL.
Self-hosting the application from a fork does not require publishing a second copy of
the documentation. A maintainer who deliberately republishes it under another
repository or account must review and update the VitePress base and sitemap together
with the validator's expected public base and host allowlist.

## 14. Optional renewal email — implemented and provider-gated

The ledger works without an email provider. The tracked example deliberately keeps
`EMAIL_REMINDER_MODE` at `disabled`, sets the provider-configuration revision to `0`,
and has no `send_email` binding. In that state every subscription starts with email
off, the UI reports the capability as unavailable, and no delivery call is made.

Email remains an explicit choice on each subscription. Account defaults control only
the lead time and local hour; they never opt a subscription in. Amount, currency,
payment method, and manual-renewal status never enable a reminder automatically.

### 14.1 Exercise the fake sender locally

Copy `wrangler.example.jsonc` to the ignored `wrangler.local.jsonc`, then change only
the top-level local reminder variables for this exercise:

```jsonc
"EMAIL_REMINDER_MODE": "fake",
"EMAIL_REMINDER_FROM": "reminders@example.invalid",
"EMAIL_REMINDER_PROVIDER_CONFIG_REVISION": "1"
```

Do not add a local `send_email` binding and do not set an email binding to `remote`.
The application's deterministic fake records non-sensitive delivery metadata only and
cannot contact a mailbox. Start the application with the private configuration:

```sh
CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=wrangler.local.jsonc pnpm dev
```

Before enabling any subscription, manually invoke the hourly trigger once:

```sh
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=5+*+*+*+*&format=json"
```

The structured outcome must be successful and the privacy-safe log counters must show
no attempted delivery. Next enable email on one fictional local subscription, choose a
lead time whose window includes the current local date, set a delivery hour that has
already started but whose local day is still open, invoke the route again, and inspect
the coarse delivery state. For deterministic automation, the route also accepts a
`time` query value expressed as Unix milliseconds; application tests inject a matching
clock. Local and CI must never use the native provider.

### 14.2 Configure the native production binding

The native Cloudflare path is suitable for the maintainer and a small friend group:

1. Onboard a sender domain, optionally a dedicated subdomain such as
   `notify.example.com`, in Cloudflare Email Service.
2. Add each intended Free-plan recipient as an Email Routing destination address and
   have that person complete Cloudflare's verification email.
3. Add a narrowly restricted binding only inside `env.production` in the ignored
   `wrangler.local.jsonc`:

   ```jsonc
   "send_email": [
     {
       "name": "EMAIL",
       "allowed_sender_addresses": ["reminders@notify.example.com"],
       "allowed_destination_addresses": ["owner@example.net"]
     }
   ],
   "vars": {
     "ENVIRONMENT": "production",
     "PUBLIC_ORIGIN": "https://sublist.example.com",
     "TEAM_DOMAIN": "example.cloudflareaccess.com",
     "POLICY_AUD": "replace-with-production-access-audience",
     "EMAIL_REMINDER_MODE": "cloudflare",
     "EMAIL_REMINDER_FROM": "reminders@notify.example.com",
     "EMAIL_REMINDER_PROVIDER_CONFIG_REVISION": "1"
   }
   ```

   Replace every example value. Keep the real sender, destinations, revision, domain,
   and Access metadata out of Git. Increase the positive revision whenever the binding,
   sender, or recipient policy changes.

4. Back up D1 and apply every pending migration through
   `0007_split_interface_email_locales.sql`, then run the production dry run and
   deploy. The existing production schedule already contains the daily FX trigger and
   the independent `5 * * * *` reminder trigger.
5. Observe one normal production hourly run while all subscription reminder toggles
   are still off. Then enable one operator-owned subscription, verify one delivery and
   its redacted counters, and only then enable reminders for friends.

Cloudflare currently allows sends to verified destination addresses free of charge on
Workers Free. Sending to arbitrary recipients through Cloudflare Email Sending
requires Workers Paid. Configuring the Cron and leaving this repository's provider
disabled does not by itself opt an account into a paid Workers plan. Review current
limits before activation.

Preview may use the application fake or one strictly allowlisted operator destination.
Disabling `EMAIL_REMINDER_MODE` or removing the production binding pauses provider
delivery without changing subscription choices or the core ledger.

### 14.3 Upgrade archives and clear a safety suspension

The runtime exports and imports archive schema V4 only. Historical upgrades remain
offline operator steps and do not add runtime compatibility.

If the source is V2, first convert it to V3. Existing subscriptions remain
reminder-disabled because the V2-to-V3 tool does not infer opt-in:

```sh
node tools/reminder-migration/cli.mjs \
  --input /private/path/opensublists-archive-v2.json \
  --output /private/path/opensublists-archive-v3.json
```

Then convert the reviewed V3 archive to V4. The locale transformer copies
`profile.preferredLocale` into both `profile.interfaceLocale` and
`profile.emailLocale`:

```sh
pnpm migration:locale -- \
  --input /private/path/opensublists-archive-v3.json \
  --output /private/path/opensublists-archive-v4.json
```

Both tools validate their source schema strictly, enforce private owner-only output,
and refuse to overwrite an existing target unless `--overwrite` is supplied
deliberately. Keep every archive outside the repository. V3 is accepted only by the
offline locale transformer, never by the Worker import endpoints.

If an identity-email collision created a system suspension, first resolve the ownership
conflict and create a D1 recovery point. Then clear only the matching suspension by
internal user ID:

```sh
node tools/reminders/clear-identity-suspension.mjs \
  --user-id 00000000-0000-0000-0000-000000000000 \
  --confirm-user-id 00000000-0000-0000-0000-000000000000 \
  --database DB \
  --config wrangler.local.jsonc \
  --remote \
  --env production
```

The command rechecks uniqueness and never accepts or prints an email address. A
successful clear also pauses all reminders, advances the reminder revision, and cancels
stale unattempted deliveries so the last stored address cannot resume receiving email.
The affected user must sign in again to refresh the verified primary email, review it in
Settings, and explicitly unpause reminders. Do not bypass this workflow with ad hoc SQL
or the user-facing `/me` endpoint.

## 15. Troubleshooting

| Symptom                                            | Check                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Pages root works but assets are 404                | The canonical site is pinned to `/SubList/`; deliberate republication requires matching VitePress base, sitemap, and validator changes. |
| Pages workflow cannot configure the site           | Select **GitHub Actions** as the Pages source, then rerun the workflow.                                                                 |
| `pnpm docs:build` reports a missing input          | Restore the canonical guide or Dashboard image; the build intentionally fails instead of publishing an incomplete include.              |
| Wrangler rejects the configuration                 | Compare `wrangler.local.jsonc` with the tracked example and keep every binding name unchanged.                                          |
| D1 migration targets the wrong database            | Stop and verify the selected environment, binding, database name, and UUID before rerunning it.                                         |
| Access allows an unexpected address                | Use an explicit **Emails** selector; One-time PIN alone is not an allowlist.                                                            |
| Access succeeds but the Worker rejects the session | Verify the bare team domain and exact application audience in the ignored configuration.                                                |
| Dashboard conversion is unavailable                | Confirm the initial FX snapshot and inspect the scheduled refresh result without logging subscription data.                             |
| A Cron change is not visible immediately           | Allow several minutes for propagation and verify the exact UTC expression in Worker settings.                                           |
| Reminder capability stays unavailable              | Leave reminders disabled until the sender binding, sender identity, and allowed recipient policy are all configured.                    |
| Reminder Cron runs but sends nothing               | Confirm that the subscription itself is explicitly opted in and its lead-time window is open; account defaults alone never enable it.   |

## Official references

- [Create and bind a D1 database](https://developers.cloudflare.com/d1/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare Access One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [VitePress deployment](https://vuejs.github.io/vitepress/v1/guide/deploy)
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)
- [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Configure Cloudflare email send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Cloudflare Email Routing destination addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
- [Cloudflare Email Routing subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)

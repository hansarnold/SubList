# Self-host OpenSubLists on Cloudflare

> Status: Supported manual deployment path
> Last updated: 2026-08-23
> Expected cost for a small personal deployment: Cloudflare Free plan limits

This guide creates one full-stack Worker, one D1 database, one custom hostname, and
one hostname-scoped Cloudflare Access application. The repository never needs an API
token, an Access JWT, an approved email address, or operator-owned resource metadata.

## 1. Prerequisites

- Node.js 24 and Corepack.
- A Cloudflare account.
- An active Cloudflare DNS zone in that account.
- An unused hostname such as `sublist.example.com` with no conflicting CNAME.
- Permission to create Workers, D1 databases, and Cloudflare Access applications.

Clone the repository and install the pinned dependencies:

```sh
git clone https://github.com/hansarnold/SubList.git
cd SubList
corepack enable
pnpm install
```

Run `pnpm dev` before provisioning anything remotely. Local development uses the
tracked example configuration, a loopback-only identity, and local D1 state.

## 2. Create the private operator configuration

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

## 3. Create the production D1 database

Create an operator-owned database:

```sh
pnpm exec wrangler d1 create open-sublists-production --config wrangler.local.jsonc
```

If Wrangler offers to edit the configuration automatically, decline and update only
the `env.production.d1_databases` entry manually. Record the returned database name
and UUID.

Replace these example values in `wrangler.local.jsonc`:

```jsonc
"database_name": "open-sublists-production",
"database_id": "00000000-0000-0000-0000-000000000000"
```

Use a separate D1 database for preview if a preview environment is enabled later.

## 4. Configure Cloudflare Access

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
team hostname and the exact application audience.

## 5. Complete the production configuration

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

## 6. Validate and deploy

Run all local quality gates and validate the real production configuration:

```sh
pnpm check
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

## 7. Post-deployment verification

Verify all of the following before entering real subscription data:

- An unauthenticated request is redirected to Cloudflare Access.
- Only an explicitly allowlisted address receives access after OTP authentication.
- `GET /api/v1/me` returns the expected current user.
- Subscription create, edit, archive, and unarchive operations succeed.
- API responses use `Cache-Control: private, no-store`.
- The Worker cannot be reached through `workers.dev` or a version preview URL.
- JSON export downloads a portable archive.

## 8. Inviting and removing users

OpenSubLists has no application password or invitation table. Add or remove email
addresses in the Cloudflare Access policy. Each authenticated identity is provisioned
as an isolated application user on first access.

## 9. Updating an installation

Pull and verify the new version locally, then apply any pending remote migrations
before deploying the Worker:

```sh
git pull --ff-only
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:production
pnpm deploy:production
```

Never copy an operator's production D1 database into preview by default. Use D1 Time
Travel for platform recovery and the application JSON export for user-controlled
portability.

## Official references

- [Create and bind a D1 database](https://developers.cloudflare.com/d1/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Access One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

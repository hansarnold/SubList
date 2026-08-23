# OpenSubLists

OpenSubLists is a small, self-hostable subscription tracker built as a responsive website on Cloudflare Workers and D1.

It provides recurring billing calculations, per-currency reporting, categories, payment methods, and portable JSON import/export. Cloudflare Access supplies invite-only email authentication for hosted environments, while a fixed local identity keeps development fully offline from Access.

## Stack

- React, React Router, TanStack Query, and i18next in the browser.
- Hono and TypeScript in one full-stack Cloudflare Worker.
- Cloudflare D1 with explicit parameterized SQL and numbered migrations.
- Vite with the Cloudflare plugin for a production-like local runtime.
- Vitest for domain and Worker/D1 integration tests.

## Local Development

Requirements:

- Node.js 24, as pinned in `.node-version`.
- Corepack, which installs the pinned pnpm version from `package.json`.

```sh
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` applies all pending migrations and then starts the website, Worker API, and local D1 binding together. Local D1 data persists in `.wrangler/state` and never touches preview or production data.

The development server listens only on `http://localhost:5173`. The production-shaped `pnpm preview` command uses the same loopback address and port.

Local requests use the fixed identity `developer@localhost.invalid`. Arbitrary user impersonation is not exposed through an HTTP header or production code path.

## Useful Commands

| Command                  | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `pnpm dev`               | Migrate local D1 and start the complete local website       |
| `pnpm db:migrate:local`  | Apply pending migrations to local D1                        |
| `pnpm typegen`           | Regenerate Worker binding and runtime types                 |
| `pnpm test`              | Run pure domain unit tests                                  |
| `pnpm test:integration`  | Run Worker and D1 integration tests                         |
| `pnpm check`             | Run formatting, lint, type checks, tests, and the build     |
| `pnpm preview`           | Build and preview the production-shaped bundle locally      |
| `pnpm deploy:preview`    | Build and deploy with the preview Cloudflare environment    |
| `pnpm deploy:production` | Build and deploy with the production Cloudflare environment |

## Cloudflare Deployment

The maintainer deployment is live at
[sublist.hansarnold.uk](https://sublist.hansarnold.uk/). It uses the
`open-sublists-production` Worker, an isolated production D1 database, and a
hostname-scoped Cloudflare Access application.

Cloudflare Access uses one-time email PINs, so OpenSubLists does not store passwords.
Approved emails are managed in the Access policy and are never committed to this
repository.

After Wrangler is authenticated, the initial production release is:

```sh
pnpm db:migrate:production
pnpm deploy:production
```

Production disables both `workers.dev` and version preview URLs to prevent an
unprotected alternate entry point. The committed database ID, Access audience, and
team domain are deployment metadata rather than credentials; forks should replace
them with their own resources. API tokens, JWTs, and approved email addresses must
never be committed.

The preview environment remains a fail-closed template until separate preview D1,
hostname, and Access resources are provisioned.

See [Environments and Deployment](./docs/environments-and-deployment.md) for the complete release and recovery procedure.

## Architecture and Product Decisions

The implementation intentionally remains one Worker plus one D1 database per environment. Business rules are runtime-independent TypeScript, and every data operation is scoped to the verified current user.

Start with the [documentation index](./docs/README.md) for the product scope, billing rules, data model, API contract, UI flow, and security decisions.

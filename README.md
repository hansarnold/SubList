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

The committed `wrangler.jsonc` contains safe local values and non-functional preview/production placeholders. Before the first hosted deployment:

1. Replace the preview or production origin, Access team domain, and Access audience.
2. Configure a custom hostname protected by Cloudflare Access OTP and an email allowlist.
3. Keep preview and production D1 bindings separate.
4. Apply remote migrations before releasing code that depends on them.

Wrangler can provision a missing D1 binding when deploying, or an existing database ID can be added by the operator. Production disables its alternate `workers.dev` route to prevent bypassing Access.

See [Environments and Deployment](./docs/environments-and-deployment.md) for the complete release and recovery procedure.

## Architecture and Product Decisions

The implementation intentionally remains one Worker plus one D1 database per environment. Business rules are runtime-independent TypeScript, and every data operation is scoped to the verified current user.

Start with the [documentation index](./docs/README.md) for the product scope, billing rules, data model, API contract, UI flow, and security decisions.

# OpenSubLists Documentation

> Last updated: 2026-08-23

This directory is the authoritative product, implementation, and operations specification for OpenSubLists.

## Reading Order

1. [Product and Technical Plan](./plan.md) — Product scope, principles, roadmap, and current decisions.
2. [Architecture and Technology Decisions](./architecture.md) — Languages, tools, module boundaries, and dependency direction.
3. [Data Model](./data-model.md) — D1 tables, constraints, tenant ownership, DDL, and extension paths.
4. [Billing Rules](./billing-rules.md) — Deterministic recurrence, money normalization, rounding, and test matrix.
5. [API Contract](./api-contract.md) — `/api/v1` resources, payloads, errors, actions, and security rules.
6. [MVP UI Flow](./ui-flow.md) — Routes, responsive behavior, forms, lifecycle interactions, accessibility, and the selected Dashboard and Subscriptions visual references.
7. [Import and Export](./import-export.md) — Versioned archive format, preview, conflicts, and native SubList migration.
8. [Environments and Deployment](./environments-and-deployment.md) — Local, preview, production, migrations, CI, deployment, and recovery.
9. [Implementation Readiness Checklist](./pre-implementation-checklist.md) — Completed local gates and remaining hosted-deployment inputs.

## Authority Rules

- A focused document is authoritative for its subject.
- `plan.md` is a summary and roadmap. It must not redefine details owned by another document.
- `data-model.md` owns persistence names and constraints.
- `billing-rules.md` owns schedule and reporting semantics.
- `api-contract.md` owns transport names and HTTP behavior.
- `import-export.md` owns archive schema and conflict handling.
- `ui-flow.md` owns user interaction and information architecture.
- `environments-and-deployment.md` owns operational configuration and release gates.
- `architecture.md` owns tool and module-boundary decisions.

If two documents conflict, update them in the same change. Do not leave compatibility notes as a substitute for resolving the conflict.

## Documentation Language

Agent-facing planning, implementation notes, architecture documents, and code comments use English. User-facing application copy is localizable and initially targets English and Simplified Chinese.

## Deferred Inputs

The following are hosted-deployment or future-adapter inputs rather than unresolved MVP architecture:

- Cloudflare account-specific IDs, hostnames, and Access audience values.
- A redacted native SubList JSON export fixture for the migration adapter.
- Reminder and exchange-rate provider selection, because those features are outside the MVP.

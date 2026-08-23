# OpenSubLists Documentation

> Last updated: 2026-08-24

This directory is the authoritative product, implementation, and operations specification for OpenSubLists.

## Reading Order

1. [Product and Technical Plan](./plan.md) — Product scope, principles, roadmap, and current decisions.
2. [Reporting, Presets, and Symbols Refactor Plan](./reporting-presets-refactor-plan.md) — Implemented cross-cutting behavior, implementation sequence, and reusable legacy operator cutover.
3. [Architecture and Technology Decisions](./architecture.md) — Languages, tools, module boundaries, and dependency direction.
4. [Data Model](./data-model.md) — D1 tables, constraints, tenant ownership, DDL, and extension paths.
5. [Billing Rules](./billing-rules.md) — Deterministic recurrence, money normalization, FX conversion, rounding, and test matrix.
6. [API Contract](./api-contract.md) — `/api/v1` resources, payloads, errors, actions, and security rules.
7. [MVP UI Flow](./ui-flow.md) — Routes, responsive behavior, forms, lifecycle interactions, accessibility, and the selected Dashboard and Subscriptions visual references.
8. [Import and Export](./import-export.md) — Current archive format, preview, conflicts, and native SubList migration.
9. [Self-hosting](./self-hosting.md) — Fork-oriented Cloudflare resource provisioning, private configuration, and first deployment.
10. [Environments and Deployment](./environments-and-deployment.md) — Local, preview, production, migrations, CI, deployment, and recovery.
11. [Implementation Readiness Checklist](./pre-implementation-checklist.md) — Completed MVP and refactor gates plus remaining hosted-deployment inputs.

## Authority Rules

- A focused document is authoritative for its subject.
- `plan.md` is a summary and roadmap. It must not redefine details owned by another document.
- `reporting-presets-refactor-plan.md` owns the cross-document implementation sequence, approved preset and icon catalogs, and reusable legacy v1-to-v2 operator cutover; focused documents still own their final contracts.
- `data-model.md` owns persistence names and constraints.
- `billing-rules.md` owns schedule and reporting semantics.
- `api-contract.md` owns transport names and HTTP behavior.
- `import-export.md` owns archive schema and conflict handling.
- `ui-flow.md` owns user interaction and information architecture.
- `self-hosting.md` owns first-time operator provisioning and configuration.
- `environments-and-deployment.md` owns operational configuration and release gates.
- `architecture.md` owns tool and module-boundary decisions.

If two documents conflict, update them in the same change. Do not leave compatibility notes as a substitute for resolving the conflict.

## Documentation Language

Agent-facing planning, implementation notes, architecture documents, and code comments use English. User-facing application copy is localizable and initially targets English and Simplified Chinese.

## Deferred Inputs

The following are future deployment or adapter inputs rather than unresolved MVP architecture:

- Separate preview D1, hostname, and Access resources before preview releases are introduced.
- A redacted native SubList JSON export fixture for the migration adapter.
- A reminder provider if email reminders enter approved scope.

# OpenSubLists Documentation

> Last updated: 2026-08-25

This directory is the authoritative product, implementation, and operations specification for OpenSubLists.

## Reading Order

1. [Product and Technical Plan](./plan.md) — Product scope, principles, roadmap, and current decisions.
2. [UX Simplification, Locale Separation, Email Activation, and Dashboard Charts Plan](./ux-simplification-locale-email-and-charts-plan.md) — Implemented Phase 5 resource flows, category browsing, language settings, and separate Bar and Pie charts, plus the still operator-gated email activation procedure.
3. [Subscription Editor, Email Reminders, GitHub Pages, and Dashboard Charts Plan](./subscription-editor-docs-and-charts-plan.md) — Phase 4 implementation history for direct resource creation, provider-gated renewal email, public self-hosting documentation, and the first chart delivery.
4. [Reporting, Presets, and Symbols Refactor Plan](./reporting-presets-refactor-plan.md) — Implemented cross-cutting behavior, implementation sequence, and reusable legacy operator cutover.
5. [Architecture and Technology Decisions](./architecture.md) — Languages, tools, module boundaries, and dependency direction.
6. [Data Model](./data-model.md) — D1 tables, constraints, tenant ownership, DDL, and extension paths.
7. [Billing Rules](./billing-rules.md) — Deterministic recurrence, money normalization, FX conversion, rounding, and test matrix.
8. [API Contract](./api-contract.md) — `/api/v1` resources, payloads, errors, actions, and security rules.
9. [MVP UI Flow](./ui-flow.md) — Routes, responsive behavior, forms, lifecycle interactions, accessibility, and the selected Dashboard and Subscriptions visual references.
10. [Import and Export](./import-export.md) — Current archive format, preview, conflicts, and native SubList migration.
11. [Self-hosting](./self-hosting.md) — Fork-oriented Cloudflare resource provisioning, private configuration, and first deployment.
12. [Environments and Deployment](./environments-and-deployment.md) — Local, preview, production, migrations, CI, deployment, and recovery.
13. [Implementation Readiness Checklist](./pre-implementation-checklist.md) — Completed MVP and refactor gates plus remaining hosted-deployment inputs.

## Authority Rules

- A focused document is authoritative for its subject.
- `plan.md` is a summary and roadmap. It must not redefine details owned by another document.
- `ux-simplification-locale-email-and-charts-plan.md` owns the Phase 5 implementation
  history and acceptance target: resource-selection presentation and copy,
  independent interface and email locales, category browse/manage separation,
  provider activation sequencing, and simultaneous Bar and Pie presentation. Focused
  contracts are authoritative for the implemented persistence, transport, and
  operations.
- `subscription-editor-docs-and-charts-plan.md` owns the follow-up implementation
  history for direct resource creation, per-subscription renewal email, the public
  GitHub Pages site, and the first Dashboard chart delivery. Its superseded Phase 4
  presentation choices do not override the Phase 5 corrective plan.
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
- Private sender-domain and verified-destination configuration before a self-hoster
  activates the implemented provider-gated renewal-email capability.

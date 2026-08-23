# Agent Instructions

- Always write agent-facing documentation, planning documents, implementation notes, and code comments in English.
- Keep user-facing product copy localizable. Do not hard-code English UI text into domain logic.
- Prefer a simple architecture justified by current requirements. Do not introduce infrastructure solely for hypothetical scale.
- Preserve tenant isolation: derive the current user from the verified server-side identity and scope every business-data operation to that user.
- Treat `docs/README.md` as the planning-document index. When a decision changes, update the authoritative detailed document and reconcile `docs/plan.md` in the same change.

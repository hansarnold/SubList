# OpenSubLists Import and Export Format

> Status: Approved refactor target archive specification
> Last updated: 2026-08-23  
> Media type: `application/json`  
> Current target schema version: `2`

## 1. Goals

The archive format must:

- Provide a user-owned backup independent of D1.
- Move data between OpenSubLists deployments.
- Support a controlled migration from the native SubList application.
- Preserve relationships without exposing authentication credentials.
- Detect unsupported versions and conflicts before writing data.
- Never discard unsupported source fields silently.

## 2. Non-goals

- Exporting Cloudflare Access identities, JWTs, or session data.
- Exporting D1 implementation details such as micro-unit columns.
- Providing a streaming format for very large datasets.
- Fetching archives from remote URLs.
- Treating import as a database restore mechanism.

## 3. Archive Envelope

```json
{
  "format": "opensublists",
  "schemaVersion": 2,
  "archiveId": "550e8400-e29b-41d4-a716-446655440000",
  "exportedAt": "2026-08-23T08:15:30.123Z",
  "generator": {
    "name": "OpenSubLists",
    "version": "0.1.0"
  },
  "profile": {
    "displayName": "Example User",
    "timezone": "Asia/Shanghai",
    "reportingCurrency": "CNY"
  },
  "categories": [],
  "paymentMethods": [],
  "subscriptions": []
}
```

Required top-level properties are fixed for schema version 2. Unknown top-level properties produce warnings but do not fail import unless they conflict with a defined field.

## 4. Exported Profile

```ts
type ExportProfile = {
  displayName: string | null;
  timezone: string;
  reportingCurrency: string;
};
```

The archive excludes:

- Internal user ID.
- Primary email.
- Access subjects.
- Authentication provider records.
- Session settings managed by Cloudflare Access.

Profile settings are imported only when the user explicitly selects that option during confirmation.

## 5. Category Record

```json
{
  "id": "c5854b7b-6279-4d18-b725-3c2fcf314962",
  "name": "Development Tools",
  "color": "#6366F1",
  "symbol": { "type": "icon", "value": "device" },
  "position": 0,
  "createdAt": "2026-08-01T08:00:00.000Z",
  "updatedAt": "2026-08-10T09:30:00.000Z"
}
```

`name_key` is not exported. The importer rebuilds it with the current normalization function.

## 6. Payment Method Record

```json
{
  "id": "43114e63-e950-4466-a905-6bd6fb8a356f",
  "name": "Visa",
  "kind": "card",
  "label": "•••• 1234",
  "symbol": { "type": "icon", "value": "brand_visa" },
  "position": 0,
  "createdAt": "2026-08-01T08:00:00.000Z",
  "updatedAt": "2026-08-10T09:30:00.000Z"
}
```

The format supports only safe display labels. It must never contain a complete card number, bank credential, or payment secret.

## 7. Subscription Record

```json
{
  "id": "667c6f4c-c010-4d09-8e92-17b8580499aa",
  "name": "Example Service",
  "amount": "9.99",
  "currency": "USD",
  "recurrence": {
    "unit": "month",
    "count": 1,
    "anchorOn": "2026-08-31",
    "anchorMode": "calendar_day"
  },
  "status": "active",
  "cancelledAt": null,
  "archivedAt": null,
  "categoryId": "c5854b7b-6279-4d18-b725-3c2fcf314962",
  "paymentMethodId": "43114e63-e950-4466-a905-6bd6fb8a356f",
  "symbol": { "type": "emoji", "value": "✨" },
  "websiteUrl": "https://example.com",
  "notes": null,
  "createdAt": "2026-08-01T08:00:00.000Z",
  "updatedAt": "2026-08-10T09:30:00.000Z"
}
```

The archive intentionally omits `nextBillingOn` because it is derived and may be stale. The importer recalculates it using the target user's current time zone and local date.

## 8. Complete Type Definition

```ts
type ResourceSymbol = { type: "icon"; value: string } | { type: "emoji"; value: string } | null;

type OpenSubListsArchiveV2 = {
  format: "opensublists";
  schemaVersion: 2;
  archiveId: string;
  exportedAt: string;
  generator: {
    name: "OpenSubLists";
    version: string;
  };
  profile: {
    displayName: string | null;
    timezone: string;
    reportingCurrency: string;
  };
  categories: Array<{
    id: string;
    name: string;
    color: string;
    symbol: ResourceSymbol;
    position: number;
    createdAt: string;
    updatedAt: string;
  }>;
  paymentMethods: Array<{
    id: string;
    name: string;
    kind: "card" | "wallet" | "bank" | "store" | "other";
    label: string | null;
    symbol: ResourceSymbol;
    position: number;
    createdAt: string;
    updatedAt: string;
  }>;
  subscriptions: Array<{
    id: string;
    name: string;
    amount: string;
    currency: string;
    recurrence: {
      unit: "day" | "week" | "month" | "year";
      count: number;
      anchorOn: string;
      anchorMode: "calendar_day" | "end_of_month";
    };
    status: "active" | "cancelled";
    cancelledAt: string | null;
    archivedAt: string | null;
    categoryId: string | null;
    paymentMethodId: string | null;
    symbol: ResourceSymbol;
    websiteUrl: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};
```

## 9. Export Behavior

- Export only the current user's data.
- Sort categories by position and ID.
- Sort payment methods by position and ID.
- Sort subscriptions by ID for deterministic archives.
- Use decimal money strings in canonical non-scientific form.
- Preserve resource IDs and relationship IDs.
- Generate a new `archiveId` for every export.
- Use the current application version as generator metadata.
- Do not mutate business data during export.

Suggested filename:

```text
opensublists-backup-2026-08-23.json
```

Suggested response headers:

```http
Content-Type: application/json; charset=utf-8
Content-Disposition: attachment; filename="opensublists-backup-2026-08-23.json"
Cache-Control: private, no-store
```

## 10. Validation Pipeline

Import validation runs in this order:

1. Enforce request and archive size limits.
2. Parse JSON without evaluating code.
3. Validate the archive envelope and schema version.
4. Validate resource field types and limits.
5. Validate real dates, currencies, amounts, URLs, and recurrence rules.
6. Validate unique IDs inside each resource collection.
7. Validate category and payment method references.
8. Rebuild category name keys and detect normalized duplicates.
9. Query current-user IDs and calculate conflicts.
10. Produce a preview report without writing business data.

Validation errors include JSON-style paths but never echo complete sensitive records into logs.

## 11. Preview Response

`POST /api/v1/imports/preview` accepts:

```json
{
  "archive": {
    "format": "opensublists",
    "schemaVersion": 2
  }
}
```

The actual archive contains all required fields. Example response:

```json
{
  "data": {
    "digest": "sha256-6f5902ac...",
    "schemaVersion": 2,
    "counts": {
      "categories": 4,
      "paymentMethods": 2,
      "subscriptions": 18
    },
    "conflicts": {
      "categories": 1,
      "paymentMethods": 0,
      "subscriptions": 2
    },
    "warnings": [
      {
        "path": "subscriptions[3]",
        "code": "UNSUPPORTED_SOURCE_FIELD",
        "message": "A source price history will not be imported."
      }
    ]
  }
}
```

The digest is SHA-256 over a canonical serialization of the validated archive. Canonicalization uses the schema-defined property order, canonical decimal strings, and the array order present in the archive. It is not an authentication token.

## 12. Confirmation Request

`POST /api/v1/imports` accepts the archive again:

```json
{
  "archive": {},
  "expectedDigest": "sha256-6f5902ac...",
  "conflictStrategy": "skip",
  "importProfile": false,
  "confirmed": true
}
```

The server:

1. Recalculates the digest.
2. Repeats full validation.
3. Rejects a digest mismatch.
4. Applies the selected conflict strategy.
5. Recalculates all imported next-billing dates.
6. Writes the import atomically with D1 `batch()`.
7. Returns created, updated, skipped, and warning counts.

The preview step is an accident-prevention workflow, not an authorization mechanism. Cloudflare Access remains the authorization boundary.

## 13. Conflict Strategies

### 13.1 `skip`

- Existing current-user IDs remain unchanged.
- Conflicting incoming records are skipped.
- Non-conflicting records are inserted with their archive IDs.
- Relationships may reference an existing skipped category or payment method with the same ID.

This is the default and safest merge behavior.

### 13.2 `overwrite`

- Existing current-user records with matching IDs are updated from the archive.
- Relationships are validated after the final merged state is calculated.
- Records absent from the archive are not deleted.
- Existing `createdAt` is preserved. `updatedAt` is set to the import operation time because overwrite is a new mutation.

### 13.3 `duplicate`

- Generate new IDs for every incoming category, payment method, and subscription.
- Remap all imported relationships to the new IDs.
- Existing data is unchanged.
- Category normalized-name conflicts still require automatic suffixing or rejection; the MVP rejects and reports them rather than inventing names.

The MVP does not offer a replace-all strategy because it would combine bulk deletion with import. A future restore workflow must make that destructive behavior separate and explicit.

## 14. Import Atomicity and Limits

MVP limits:

- Archive size: 5 MiB.
- Categories: 100.
- Payment methods: 100.
- Subscriptions: 50.
- Notes: 10,000 Unicode code points per subscription.

The importer compiles validated changes into a bounded D1 batch transaction. Any failed statement rolls back the entire import.

If future limits exceed practical batch constraints, imports should move to a resumable job model with an explicit staging area. The MVP must not silently fall back to partial writes.

## 15. Current-only Schema Policy

- `schemaVersion` remains an integer and export always writes the current version.
- The runtime imports only the current archive version. Older and newer versions fail with `UNSUPPORTED_ARCHIVE_VERSION`.
- The personal deployment does not carry historical archive transformers indefinitely.
- An approved breaking refactor preserves the raw archive and D1 backup, runs one deterministic offline transformation, produces a review and verification report, and imports the transformed current archive.
- The one-time transformer is an operator cutover tool rather than an application compatibility layer.
- Database migration versions remain unrelated to archive schema versions.

### 15.1 One-time v1-to-v2 Operator Tool

The repository contains a cutover-only transformer under
`tools/refactor-migration/`. It is intentionally separate from the Worker and does
not make archive version 1 a runtime import format.

Run it against a private copy of the pre-refactor archive:

```sh
pnpm migration:refactor -- \
  --input /private/path/opensublists-archive-v1.json \
  --output-dir /private/path/refactor-review
```

The tool creates three fixed artifacts:

- `opensublists-archive-v2.json`: a schema-version-2 archive with
  `profile.reportingCurrency` copied from `profile.defaultCurrency`, canonical money
  strings, and `symbol: null` on every resource unless an explicit map is supplied.
- `opensublists-refactor-review.csv`: one human-readable row per category, payment
  method, and subscription, including original currency, amount, recurrence,
  relationships, and symbol.
- `opensublists-refactor-verification.json`: source and output SHA-256 hashes, source
  and output resource counts, exact per-currency micro-unit totals, resolved-reference
  summaries, lifecycle findings, and symbol coverage.

All content is deterministic for the same input bytes and options and contains no
source file path. The source hash covers the exact UTF-8 input bytes; the output hash
covers the exact emitted archive bytes. The tool rejects malformed JSON, unknown
fields, invalid version-1 records, duplicate IDs or normalized category names,
broken relationships, inconsistent lifecycle fields, and invalid mapping entries
before it writes any artifact.

Currency validation uses the same supported ISO-code registry as the runtime import
path. Time zones must be `UTC` or a valid named IANA zone such as `Asia/Shanghai`;
aliases such as `GMT` that runtime canonicalization rejects also fail transformation.

Symbols are opt-in. The tool never guesses them from a resource name. An operator may
provide a strict mapping file:

```json
{
  "format": "opensublists-refactor-symbol-map",
  "schemaVersion": 1,
  "symbols": [
    {
      "resourceKind": "subscription",
      "resourceId": "667c6f4c-c010-4d09-8e92-17b8580499aa",
      "symbol": { "type": "emoji", "value": "✨" }
    }
  ]
}
```

Apply it with `--symbols /private/path/symbol-map.json`. Every target must exist in
the source archive, each target may appear once, icons must use the application
allow-list, and emoji must pass the same single-grapheme rules as the application.

Existing output files cause `OUTPUT_EXISTS`; no file is overwritten by default. Use
`--overwrite` only for an intentional replacement of the three known artifacts. The
source archive, mapping file, transformed archive, CSV, verification report, and D1
backup may all contain private data and must remain outside the repository.

The operator tool sets the output directory to owner-only mode (`0700`) and every
generated or overwritten artifact to owner-read/write mode (`0600`). Text cells that
begin with `=`, `+`, `-`, or `@` are prefixed with an apostrophe in the review CSV so
spreadsheet applications treat untrusted resource names as text rather than formulas.

## 16. Native SubList Adapter

Migration from the native SubList application is an adapter into the current OpenSubLists archive, not a special database writer.

Expected mappings based on the current SubList application model:

| Native concept               | Current OpenSubLists archive                                       |
| ---------------------------- | ------------------------------------------------------------------ |
| Subscription                 | Subscription                                                       |
| Category                     | Category                                                           |
| Payment method               | Payment method                                                     |
| Billing amount and currency  | `amount` and `currency`                                            |
| Billing interval and unit    | `recurrence`                                                       |
| Website and notes            | Same fields                                                        |
| Archived state               | `archivedAt` when representable                                    |
| Pause history                | Warning; not imported                                              |
| Price history                | Warning; current amount only                                       |
| Trial or introductory offer  | Warning; base recurring subscription only                          |
| Custom icons and backgrounds | Map one supported symbol when exact; otherwise warn and use `null` |
| Native reminder settings     | Warning; reminder rules are outside scope                          |

Implementation requires a redacted real export fixture. Field mappings must not be guessed from the native database when a supported JSON export is available.

## 17. Security and Privacy

- Import only uploaded JSON; do not fetch a URL supplied by the archive.
- Never render imported strings as HTML.
- Do not request imported website URLs during preview.
- Reject prototype-pollution keys at untyped boundaries or parse through strict schemas.
- Do not log archive bodies, notes, labels, or profile values.
- Export responses are private and non-cacheable.
- Import errors reveal only the current user's archive contents.
- The UI warns that an export may contain sensitive subscription and payment-label data.

## 18. Test Cases

- Round trip export → preview → import into an empty user.
- Preserve category and payment method relationships.
- Round-trip category, payment-method, and subscription symbols.
- Reject unknown icon tokens, text or multiple-emoji values, markup, image URLs, and uploads.
- Recalculate `nextBillingOn` rather than importing it.
- Reject duplicate resource IDs inside an archive.
- Reject broken relationship IDs.
- Reject invalid decimal values and dates.
- Reject any archive version other than the current version.
- Apply every conflict strategy deterministically.
- Roll back all changes when one write fails.
- Reject digest mismatch.
- Ensure one user cannot conflict with or overwrite another user's resources.
- Report every unsupported native SubList field.

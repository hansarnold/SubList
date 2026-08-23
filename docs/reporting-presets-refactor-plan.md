# Reporting, Presets, and Symbols Refactor Plan

> Status: Complete
> Last updated: 2026-08-24
> Scope: Estimated multi-currency reporting, category and payment-method presets,
> resource symbols, and a reusable legacy v1-to-v2 operator cutover

## 1. Outcome

This refactor keeps OpenSubLists a lightweight subscription ledger. It does not add
bank synchronization, payment confirmation, or a transaction ledger. Every monetary
value presented by the Dashboard is an estimate derived from subscription schedules.

The target experience is:

- Store every subscription amount in its original currency.
- Convert all eligible estimates into the user's reporting currency for combined
  Dashboard totals.
- Preserve and display the original per-currency breakdown beside converted totals.
- Offer localized category and payment-method presets without creating a second class
  of immutable system records.
- Let categories, payment methods, and subscriptions use either an allow-listed common
  icon or one Unicode emoji.
- Perform one controlled migration of an operator's legacy data instead of
  maintaining old application schemas and archive versions indefinitely.

## 2. Approved Product Decisions

### 2.1 Estimates, Not Transactions

The application remains a planning ledger. It has no concept of paid, unpaid,
reconciled, refunded, or settled charges. The words `actual spend` must not appear in
product copy because OpenSubLists cannot observe a bank or card transaction.

The Dashboard exposes four reporting-currency estimates:

1. Monthly average: annualized recurring cost divided by 12.
2. Annualized cost: normalized cost of all active, unarchived subscriptions.
3. Current-month charges: schedule occurrences inside the user's current local month.
4. Current-year charges: schedule occurrences inside the user's current local year.

An annual subscription contributes to monthly average every month, but contributes to
current-month charges only in the month containing its billing occurrence.

Current-month and current-year estimates replay the current active, unarchived
subscription definitions across the complete local calendar period, including dates
before local today. They are not reconstructed history: editing, cancelling,
archiving, or deleting a subscription can change the estimate for the whole current
period because the ledger stores no prior state or price history.

### 2.2 Original Currency Remains Authoritative

`amount_micros` and `currency` remain the source of truth for each subscription.
Converted values are computed for a response and are never written back to the
subscription row. JSON exports retain original amounts and currencies.

The user's current `default_currency` setting becomes `reporting_currency`. The
reporting currency controls combined Dashboard estimates and is also the initial value
for a new subscription's currency field. One setting is sufficient for the personal
scope.

### 2.3 Presets Are Creation Templates

Preset definitions live in application code and contain stable keys, localization
keys, suggested colors, kinds, and symbols. Selecting a preset creates an ordinary
tenant-owned category or payment method. The resulting row can be renamed, recolored,
reordered, or deleted.

Do not add a global preset table, `is_preset`, protected system rows, or preset
provenance columns. A language change must not rename existing user content.

### 2.4 Symbols Are Structured Data

Emoji must not be embedded into resource names as a presentation convention. Category,
payment-method, and subscription records use a shared symbol representation:

```ts
type ResourceSymbol =
  { type: "icon"; value: CommonIconKey } | { type: "emoji"; value: string } | null;
```

The database stores `symbol_type` and `symbol_value`. Common icon values are stable
application-owned tokens, not React component export names.

## 3. Exchange-rate Design

### 3.1 Provider

The initial provider is the European Central Bank Data API and its daily euro foreign
exchange reference-rate series. The adapter reads the latest available `EXR` daily
reference observations for currencies against EUR.

The provider is suitable for ledger estimates, not transaction settlement. The UI
must identify the source as `ECB reference rate` and show the rate date. Currencies not
published by the provider remain valid original-currency records but cannot
participate in a combined estimate.

### 3.2 Refresh Lifecycle

The existing full-stack Worker gains a `scheduled()` handler. A production Cron
Trigger runs once per day at `18:15 UTC` and invokes the same rate-refresh application
service used by tests and an initial bounded refresh path.

Refresh behavior:

1. Fetch the latest provider observations with a strict timeout.
2. Validate the response, currency codes, date, and positive decimal rates.
3. Atomically replace the singleton snapshot and all of its rates in one D1 batch.
4. Treat an already-stored provider/date snapshot as an idempotent success.
5. Never delete the last known-good snapshot when a refresh fails.
6. Log provider, rate date, duration, rate count, and outcome without logging user data.

The Dashboard normally reads D1 only. If no snapshot exists after a fresh deployment,
one authenticated Dashboard request may perform one bounded synchronous refresh. A
failed initial refresh returns original-currency data with conversion marked
unavailable; it does not fail the entire Dashboard.

### 3.3 Freshness and Completeness

An FX snapshot has one of these response states:

- `not_needed`: every included source amount already uses the reporting currency.
- `fresh`: rate date is no more than seven calendar days before local today.
- `stale`: a complete snapshot exists but is older than seven calendar days.
- `unavailable`: no complete snapshot can convert every included currency.

Weekend and market-holiday gaps reuse the most recent reference date. Both `fresh` and
`stale` snapshots may produce estimates, but stale estimates display a prominent
warning. A combined total is returned only when every included subscription currency
and the reporting currency can be converted, except that the `not_needed` identity
case requires no provider snapshot. The server must not silently omit an
unconvertible currency or substitute a `1:1` rate.

### 3.4 Conversion Formula

ECB observations represent units of currency per EUR. Let `rate(X)` be units of `X`
per EUR, with `rate(EUR) = 1`. Conversion from source currency `S` to reporting
currency `R` is:

```text
amount_in_R = amount_in_S / rate(S) * rate(R)
```

Provider decimal strings are parsed into exact rational values. Subscription
normalization, conversion, and aggregation remain exact until the final reporting-
currency rounding boundary. No binary floating-point value participates in money or
rate arithmetic.

One Dashboard response uses one snapshot for every conversion so totals, category
breakdowns, and payment-method breakdowns cannot mix rate dates.

## 4. Preset Catalogs

Preset labels use localization keys. When a user creates a row, the label in the
active locale is copied into `name` and becomes normal user content.

### 4.1 Category Catalog

| Key                 | English label       | Suggested icon | Suggested color |
| ------------------- | ------------------- | -------------- | --------------- |
| `productivity`      | Work & Productivity | `briefcase`    | `#4F7CFF`       |
| `entertainment`     | Entertainment       | `movie`        | `#8B5CF6`       |
| `software_services` | Software & Services | `device`       | `#6366F1`       |
| `ai_services`       | AI Services         | `sparkles`     | `#7C3AED`       |
| `cloud_hosting`     | Cloud & Hosting     | `cloud`        | `#0891B2`       |
| `communication`     | Communication       | `message`      | `#16A34A`       |
| `education`         | Education           | `book`         | `#D97706`       |
| `health_fitness`    | Health & Fitness    | `heart`        | `#DC2626`       |
| `finance`           | Finance             | `chart`        | `#059669`       |
| `utilities`         | Utilities           | `bolt`         | `#EA580C`       |
| `news_media`        | News & Media        | `news`         | `#64748B`       |
| `shopping`          | Shopping            | `shopping_bag` | `#DB2777`       |
| `other`             | Other               | `dots`         | `#6B7280`       |

The recommended first-run bundle is `productivity`, `entertainment`,
`software_services`, `cloud_hosting`, `utilities`, and `other`. First run offers this
bundle as a selected checklist; the user may remove entries or start empty. The client
sends ordinary localized category inputs to a bounded batch-create operation. The
server does not receive preset keys.

Already-created normalized category names disable the corresponding quick-add action.

### 4.2 Payment-method Catalog

| Key              | English label  | Kind     | Suggested icon      |
| ---------------- | -------------- | -------- | ------------------- |
| `card`           | Bank Card      | `card`   | `credit_card`       |
| `visa`           | Visa           | `card`   | `brand_visa`        |
| `mastercard`     | Mastercard     | `card`   | `brand_mastercard`  |
| `unionpay`       | UnionPay       | `card`   | `brand_unionpay`    |
| `alipay`         | Alipay         | `wallet` | `brand_alipay`      |
| `wechat_pay`     | WeChat Pay     | `wallet` | `brand_wechat`      |
| `apple_pay`      | Apple Pay      | `wallet` | `brand_apple`       |
| `google_pay`     | Google Pay     | `wallet` | `brand_google`      |
| `paypal`         | PayPal         | `wallet` | `brand_paypal`      |
| `app_store`      | App Store      | `store`  | `brand_apple`       |
| `google_play`    | Google Play    | `store`  | `brand_google_play` |
| `bank_transfer`  | Bank Transfer  | `bank`   | `bank`              |
| `manual_invoice` | Manual Invoice | `other`  | `invoice`           |
| `other`          | Other          | `other`  | `dots`              |

A payment preset only prefills the create form. It never creates immediately because
the user may need to change the name and add a safe label such as `ending 1234`.
Multiple payment methods may originate from the same template.

Full card numbers, bank account numbers, access tokens, and payment credentials remain
forbidden.

## 5. Common Icon and Emoji Rules

### 5.1 Icon Registry

The initial icon registry is a small statically imported subset of the existing Tabler
Icons dependency. It includes the preset tokens above plus general choices for music,
games, home, food, transport, travel, security, calendar, wallet, bank, store, and
subscriptions.

Rules:

- Map application tokens to components in one central registry.
- Validate icon tokens on the server against the same shared allow-list.
- Do not dynamically import a component named by database content.
- Do not accept arbitrary SVG, HTML, image URLs, or uploaded files.
- Use a generic icon when a requested payment-brand glyph is unavailable in the
  bundled registry.
- Do not add a general subscription-service logo library or automatic favicon fetch in
  this refactor.

Tabler supplies the rendered glyphs, while stored tokens remain owned by the
application so the rendering library can be replaced later without rewriting rows.

### 5.2 Emoji

Emoji values are normalized to NFC and must contain exactly one extended grapheme
cluster after trimming. The server applies a defensive encoded-size limit. The UI
offers a curated picker and a paste field; both use the same validation.

Emoji and icons are decorative. A visible text name remains mandatory, and renderers
set decorative symbols to `aria-hidden` where the adjacent label already names the
resource.

### 5.3 Rendering Fallbacks

- Category: selected symbol, then category color dot.
- Payment method: selected symbol, then a generic icon derived from `kind`.
- Subscription: selected symbol, then the existing generated monogram.

## 6. Target Persistence Model

This refactor targets a fresh schema for a legacy operator cutover. The application does
not need runtime compatibility columns or dual reads.

### 6.1 `users`

- Replace `default_currency` with `reporting_currency`.
- Keep the three-letter uppercase currency constraint.
- Use `reporting_currency` to prefill a new subscription.

### 6.2 Tenant-owned Symbol Columns

Add the following nullable columns to `categories`, `payment_methods`, and
`subscriptions`:

```text
symbol_type   TEXT  -- icon, emoji, or NULL
symbol_value  TEXT  -- allow-listed token, one emoji grapheme, or NULL
```

Both columns are null or non-null together. `symbol_type` is restricted to `icon` or
`emoji`. Domain validation owns the icon-token allow-list and complete emoji rules;
database checks enforce paired nullability and conservative lengths.

### 6.3 `fx_snapshot`

```text
id             INTEGER  singleton primary key fixed to 1
provider       TEXT     initially ecb
rate_date      TEXT     YYYY-MM-DD
base_currency  TEXT     EUR for ECB
fetched_at     INTEGER  Unix epoch milliseconds
rate_count     INTEGER  positive validated rate count
```

The table contains exactly one row. A successful refresh replaces it in the same D1
batch that replaces all `fx_rates`; a failed batch leaves the previous snapshot and
rates intact.

### 6.4 `fx_rates`

```text
snapshot_id   INTEGER  fixed to 1; foreign-key and primary-key part
currency      TEXT     primary-key part
units_per_eur TEXT  canonical positive decimal string
```

Primary key: `(snapshot_id, currency)`. The table includes an explicit EUR row with
`units_per_eur = "1"`. Replacing the singleton snapshot cascades to its prior rates.
Rates are shared deployment data and therefore do not contain `user_id`. No daily
history or transaction-rate table is retained.

## 7. Target API Changes

### 7.1 Resource Symbols

Category, payment-method, and subscription requests and responses add:

```ts
symbol: ResourceSymbol;
```

Create accepts `null`; PATCH accepts an omitted field for no change and `null` to clear
the symbol. Import and export include the same shape.

### 7.2 Profile

Profile requests and responses replace `defaultCurrency` with
`reportingCurrency`.

### 7.3 Dashboard

The Dashboard retains `totalsByCurrency` as the exact original-currency breakdown and
adds one reporting block:

```ts
type ReportingEstimate = {
  amount: string;
  currency: string;
};

type FxStatus = {
  state: "not_needed" | "fresh" | "stale" | "unavailable";
  provider: "ecb" | null;
  rateDate: string | null;
  fetchedAt: string | null;
  missingCurrencies: string[];
};

type DashboardReporting = {
  currency: string;
  monthlyAverage: ReportingEstimate | null;
  annualized: ReportingEstimate | null;
  currentMonthCharges: ReportingEstimate | null;
  currentYearCharges: ReportingEstimate | null;
  fx: FxStatus;
};
```

Category and payment-method breakdowns use the same reporting snapshot for comparable
amount-based summaries while retaining original-currency detail where displayed.

Cross-currency amount sorting is not a raw comparison of `amount_micros`. Until a
reporting-currency sort is implemented and labeled with the snapshot date, amount sort
is available only after filtering to one currency.

## 8. Target UI Changes

### 8.1 First Run

1. Confirm locale, time zone, and reporting currency.
2. Offer the selected recommended category checklist and a Start Empty action.
3. Add the chosen categories as ordinary rows.
4. Continue to Add Subscription.

Payment methods are not seeded on first run.

### 8.2 Dashboard

The first summary row contains the four reporting-currency estimates. Each value is
labeled `Estimated`. The rate source and date appear next to the summary, with a stale
or unavailable warning when required.

The original-currency cards remain visible below the combined summary. Upcoming items
always show their original amount and currency; a converted secondary value is
optional and must use the Dashboard snapshot.

### 8.3 Category and Payment Settings

- Show preset choices before the custom form in empty and add states.
- Category presets may be selected as a batch and reviewed before creation.
- Payment presets prefill name, kind, and symbol, then require Save.
- Existing rows use the same editor regardless of how they were created.

### 8.4 Symbol Picker

The picker has Common Icons and Emoji tabs. It supports keyboard operation, visible
selection, Clear, and a text label beside every glyph. The subscription form, category
form, and payment-method form reuse one component.

## 9. Maintainer Data Cutover

Long-lived backward compatibility is out of scope. The safe cutover uses a new D1
database so the old production database remains an immediate rollback source.

1. Announce a short write freeze and record the currently deployed Worker version.
2. Export the current user archive and a D1 SQL backup.
3. Record file hashes, table counts, resource IDs, and per-currency subscription sums.
4. Run the repository's deterministic v1-to-v2 transformer against the private
   archive. It sets `reportingCurrency` from `defaultCurrency`, canonicalizes amount
   strings without changing micro-unit values, and writes `symbol: null` by default.
5. Review the generated CSV and machine verification report against the recorded
   source counts, IDs, exact per-currency micro-unit sums, relationships, and lifecycle
   states.
6. If symbols are wanted for cutover, create an explicit private mapping file and run
   the transformer again. Do not infer a symbol from a normalized name.
7. Approve the final transformed archive and its recorded output hash before import.
8. Create a fresh production D1 database and apply the new baseline schema.
9. Import the transformed data and validate IDs, relationships, counts, original
   amounts, currencies, and recurrence fields.
10. Populate the first ECB snapshot and verify all active currencies are convertible.
11. Point the private production Wrangler configuration at the new D1 database,
    deploy, and run authenticated Dashboard and CRUD smoke tests.
12. Retain the old database and all backups until the operator explicitly accepts the
    new deployment. Deletion is a separate destructive action.

The product does not retain an old archive importer solely for this cutover. A
one-purpose local transformation script and its review artifact are sufficient.

The operator command and artifact contracts are specified in
`docs/import-export.md#151-one-time-v1-to-v2-operator-tool`. Output files are fixed and
refuse to overwrite by default. No real archive, symbol map, review CSV, verification
report, or database backup belongs in version control.

## 10. Implementation Sequence

### Phase A: Domain and Schema

- Define reporting-currency, FX decimal, `ResourceSymbol`, and icon-token types.
- Add the central icon registry and localized preset catalogs.
- Replace the baseline D1 schema with the target fields and FX tables.
- Add repository methods to read and atomically replace the singleton FX snapshot.

### Phase B: FX Refresh and Reporting

- Implement the ECB adapter behind a provider interface.
- Implement idempotent snapshot validation and D1 writes.
- Add the Worker `scheduled()` handler and environment Cron Trigger.
- Add exact cross-rate conversion and the four Dashboard estimates.
- Preserve original per-currency totals and fail closed on incomplete conversion.

### Phase C: Presets and Symbols

- Extend category, payment-method, and subscription domain/API/archive models.
- Implement category batch creation for reviewed ordinary inputs.
- Add category and payment preset selectors.
- Add the shared accessible icon and emoji picker.
- Update all Dashboard, list, detail, and settings renderers and fallbacks.

### Phase D: Cutover and Deployment

- Run the one-time archive transformer and inspect its human-review CSV and
  machine-verification report.
- Exercise the full cutover against a temporary local and remote D1 database.
- Freeze production writes, repeat the verified process, switch the binding, and smoke
  test.
- Keep rollback artifacts until explicit acceptance.

## 11. Required Verification

### 11.1 Domain Tests

- EUR-to-EUR, EUR-to-foreign, foreign-to-EUR, and foreign-to-foreign conversion.
- Exact rational conversion and rounding only at the final currency boundary.
- USD and CNY subscriptions produce one CNY reporting total while original totals stay
  separate.
- Annual subscription affects monthly average but only its scheduled charge month.
- Daily and weekly occurrences contribute exactly once to month and year windows.
- Missing rates prevent every combined total and report all missing currencies.
- A single reporting-currency dataset produces complete totals with `not_needed` and no provider call.
- Stale snapshots produce totals plus a warning.

### 11.2 Provider and Worker Tests

- Valid ECB response creates one complete idempotent snapshot.
- Malformed, partial, non-positive, timed-out, and out-of-order responses do not replace
  the last known-good snapshot.
- Scheduled and initial-refresh paths call the same application service.
- The scheduled handler can be exercised through the local Cloudflare Vite scheduled
  route.

### 11.3 Preset and Symbol Tests

- Locale selection changes preset labels before creation but never renames saved rows.
- Category quick-add respects normalized-name uniqueness.
- Payment presets remain editable and allow multiple instances.
- Unknown icon tokens, malformed emoji, arbitrary markup, and image URLs are rejected.
- Symbol fallbacks render when values are null or a bundled brand glyph is unavailable.
- Keyboard and screen-reader labels cover the symbol picker.

### 11.4 Cutover Verification

- Source and target IDs, counts, relationships, original amounts, currencies, statuses,
  anchors, and recurrence rules match.
- Converted totals are reviewed separately and are not used as migration invariants.
- Export after cutover round-trips through the current archive format.
- The old D1 binding can restore the previous deployment without data transformation.

## 12. Non-goals

- Actual charge, payment, refund, or reconciliation records.
- Historical exchange-rate valuation or transaction-date FX.
- User-editable or manual exchange rates in this refactor.
- Automatic bank, card, email, invoice, or App Store ingestion.
- Arbitrary SVG, remote image URLs, favicon fetching, or uploaded icons.
- A comprehensive subscription-brand logo library.
- Runtime support for the pre-refactor database or archive shape after the operator
  cutover is accepted.

## 13. Official References

- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Wrangler trigger configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#triggers)
- [Cloudflare D1 database `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [ECB Data API](https://data.ecb.europa.eu/help/api/data)
- [ECB euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)

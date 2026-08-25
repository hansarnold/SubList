# UX Simplification, Locale Separation, Email Activation, and Dashboard Charts Plan

> Status: Implemented, verified, migrated, and deployed; operator-first email
> activation remains gated
>
> Last updated: 2026-08-25
>
> Scope: Correct the Phase 4 resource-selection UI, separate interface and email
> locales, remove non-actionable controls and notices, activate the existing email
> delivery path safely, add an information-dense category browsing surface, and show
> Bar and Pie charts as separate visualizations

## 1. Outcome

Phase 4 delivered the required capabilities, but several presentation choices make
simple tasks look like configuration work. This corrective phase keeps the existing
tenant-owned resource model, reminder scheduler, D1 delivery ledger, and one-Worker
architecture while simplifying what a person sees and does.

The approved outcome is:

- Interface language and renewal-email language are independent saved preferences.
- A valid difference between those languages never produces a warning or a
  "use interface language" action.
- `Preset` remains an internal implementation term. Product copy describes common
  choices and the result of an action.
- Category and payment-method pages show saved resources first, not a permanent wall
  of templates.
- Categories become a first-class browsing dimension without turning Category
  Settings into an analytics page.
- Subscription Create and Edit continue to support saved resources, common choices,
  and custom creation without leaving the form.
- Repeated status text, multi-select checkboxes, ambiguous buttons, and non-actionable
  provider notices are removed from ordinary flows.
- Category and payment-method breakdowns each show a Bar chart and a Pie chart at the
  same time. A one-group breakdown still renders both charts.
- Renewal email is activated through the existing Worker, hourly Cron, D1 outbox, and
  Cloudflare email adapter. No second Worker or Queue is introduced.

This document supersedes the Phase 4 interaction and presentation decisions called
out in Section 2. It does not supersede the preset persistence model, recurrence
planner, delivery-state machine, privacy rules, or provider-neutral email boundary in
[Subscription Editor, Email Reminders, GitHub Pages, and Dashboard Charts Plan](./subscription-editor-docs-and-charts-plan.md).

## 2. Evidence and Diagnosis

### 2.1 Resource Settings Layout

The reviewed Category Settings capture is not merely spacious; its reading order is
visually broken. The current row combines `resource-row` with `checkbox-field` while
rendering the checkbox, icon, and text as three direct flex children. The shared row
uses `justify-content: space-between`, which pushes those children to the far left,
center, and far right of a wide panel.

Consequences visible in the capture:

- The checkbox appears unrelated to the category name.
- The icon looks like a separate column with no heading.
- The name and repeated `Ready to add` status sit far from the control.
- Every row consumes much more horizontal and vertical attention than its decision
  warrants.
- The same information pattern is repeated for the entire catalog.

This is a component-composition defect, not a typography or spacing preference. The
replacement must use one compact identity group and one clear row action.

### 2.2 Ambiguous Template Operations

The current Category Settings flow asks the person to select one or more checkboxes
and then choose `Add selected`. The current Payment Method flow offers `Use preset`,
which only prefills another form and does not state whether anything is created or
selected.

Both flows expose implementation mechanics instead of the user's result. They also
conflict with the primary task, which is normally to assign one category or payment
method while editing one subscription.

### 2.3 Non-actionable Information

The current screens repeat or expose state that does not help the next decision:

- `Ready to add` repeats a fact already implied by appearing under common choices.
- Disabled checkboxes and `Already added` rows duplicate saved-resource state.
- A language-mismatch notice treats two valid independent preferences as a problem.
- An unavailable-provider notice appears in normal Profile settings even when the
  operator has intentionally left email disabled.
- Chart-mode buttons hide one valid representation in order to reveal the other.
- The same FX metadata is repeated in both breakdown cards even though both charts use
  one Dashboard snapshot.

### 2.4 Missing Charts in Valid Sparse Data

The current Dashboard renders a special text-only state when a breakdown has one
positive group. A new or migrated account commonly has one `Uncategorized` group or
one payment method, so the user can have valid monetary data and still see no Bar or
Pie chart. This state rule, combined with the Bar/Pie toggle, is why the implemented
chart capability can appear absent.

### 2.5 Audit Health

The current implementation needs a corrective pass before more Dashboard or Settings
features are added. Data semantics and accessibility foundations are reusable; the
problems are primarily hierarchy, action naming, sparse-state presentation, and
excessive controls.

### 2.6 Category Comparator Lessons

The reviewed SubList category screens expose one useful structural idea that the
current application does not yet provide: a person can browse subscriptions grouped
by category before entering category management. OpenSubLists already has category
CRUD, subscription assignment, category filtering, and Dashboard breakdown data, but
it exposes categories only as Settings resources, form associations, filters, and
charts. It does not provide a category-oriented browsing route.

Adopt these comparator ideas:

- Separate category browsing from category management.
- Make a category card useful by showing its subscriptions and a small set of clear
  estimated metrics.
- Give every card the same scan order: category identity and active count, explicit
  monthly and annual estimates, next renewal, then a short subscription preview.
- Reuse category color and symbol as a consistent identity cue.
- Let a category card drill into the existing filtered subscription list.
- Keep a direct `Manage categories` action near the page title.

Do not copy these comparator choices:

- Large photographic backgrounds, translucent overlays, or remote category media.
  They consume attention while reducing readable information density and add asset,
  licensing, contrast, theme, and self-hosting costs.
- Sparse hero-card layouts in which decoration occupies more space than the ledger
  facts. Category identity must remain understandable without loading artwork, and
  useful amounts and renewal dates must be visible without hover or another click.
- An ambiguous `Total due` label. OpenSubLists is an estimate-only ledger, so every
  amount must name its period and estimated meaning.
- Day, Week, Month, Year, or currency controls on the management screen when they do
  not change the management task.
- A detached management button at the bottom of the content or navigation state that
  makes browsing and Settings appear active at the same time.

The target borrows the comparator's information architecture, not its visual skin.
Category color and symbol provide restrained recognition; decoration never displaces
subscription, amount, recurrence, or renewal information.

## 3. Product Language Rules

`Preset` and `template` may remain code and planning vocabulary, but neither is a
primary user-facing operation.

Use these labels:

| Context                            | English                               | Simplified Chinese          | Result                                                           |
| ---------------------------------- | ------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| Selector section                   | `Saved categories`                    | `已保存的分类`              | Choose an existing row                                           |
| Selector section                   | `Common categories`                   | `常用分类`                  | Start from an application suggestion                             |
| Selector section                   | `Saved payment methods`               | `已保存的付款方式`          | Choose an existing row                                           |
| Selector section                   | `Common payment methods`              | `常用付款方式`              | Start from an application suggestion                             |
| New-resource action                | `Create category`                     | `新建分类`                  | Open a blank category editor                                     |
| New-resource action                | `Create payment method`               | `新建付款方式`              | Open a blank payment-method editor                               |
| Subscription-dialog primary action | `Add and select`                      | `添加并选择`                | Persist the resource and assign it to the open subscription form |
| Settings-dialog primary action     | `Add category` / `Add payment method` | `添加分类` / `添加付款方式` | Persist one resource in Settings                                 |
| Empty association                  | `No category` / `No payment method`   | `无分类` / `无付款方式`     | Clear the optional association                                   |

Remove these user-facing strings and equivalent controls:

- `Use preset` / `使用预设`.
- `Ready to add` / `可添加`.
- `Add selected presets`.
- `Create from preset`.
- A repeated `Already added` row; an existing normalized resource appears only in the
  saved section.

Buttons name outcomes, not implementation sources. A suggestion can still prefill an
editable draft; the only primary action then says exactly what saving will do.

## 4. Locale Separation

### 4.1 Settings Interaction

Profile Settings displays two ordinary select fields:

1. `Interface language` — controls application navigation, forms, dates, and UI copy.
2. `Email language` — controls only renewal-email subject and body rendering.

The fields are independent:

- Changing Interface language applies immediately and persists for other devices.
- Changing Email language affects future, not already-attempted, reminder envelopes.
- Different selections are valid and silent.
- Do not show a mismatch notice, `Use interface language` button, confirmation dialog,
  or warning banner.
- A save failure is a field-level error or concise non-modal error message. It is not
  presented as a language warning.

Email language remains editable even while delivery is disabled. Deployment status
belongs in operator documentation, not beside this valid preference.

### 4.2 Persistence and API

Phase 5 replaces the shared locale meaning with two explicit fields:

```ts
type UserLocalePreferences = {
  interfaceLocale: "en" | "zh-Hans";
  emailLocale: "en" | "zh-Hans";
};
```

Migration 0007 keeps `preferred_locale` as the interface-locale storage, adds
`email_locale`, and initializes the new value from `preferred_locale`. The API
uses the clearer `interfaceLocale` name even though the established D1 column remains
additive and rollback-safe. A later table rebuild is not justified only to rename an
internal column.

Reminder envelope invalidation changes accordingly:

- An `email_locale` change advances `email_reminder_revision`.
- A `preferred_locale` change does not alter reminder eligibility or invalidate an
  email envelope.
- Email rendering reads only `email_locale`.
- Browser localization reads API `interfaceLocale`, backed by `preferred_locale`, with
  the unauthenticated browser locale used only before the user profile is available.

### 4.3 Archive Migration

The current archive format is schema V4 and exports both locale fields. The runtime
imports V4 only. A one-time maintainer transformer converts V3 by assigning its
`preferredLocale` to both target fields:

```sh
pnpm migration:locale -- \
  --input /private/path/opensublists-archive-v3.json \
  --output /private/path/opensublists-archive-v4.json
```

The tool is offline, strict, size-bounded, owner-only, and refuses to replace an
existing output unless `--overwrite` is supplied deliberately. Migration 0007 has
been applied to the hosted database after recording an exact recovery point and
verifying row counts and locale backfill. Any retained private V3 archive must be
transformed and reviewed before a future import or transfer; neither copy belongs in
the repository.

## 5. Resource Selection and Settings

### 5.1 Category Overview and Browse/Manage Separation

Add `/categories` as a top-level authenticated route and primary navigation item.
This route is for browsing and understanding grouped subscriptions. It does not
create, edit, reorder, or delete categories.

`/settings/categories` remains the only category-management surface. The Categories
page header contains one secondary `Manage categories` action that links there. A
Settings screen never inherits Dashboard period controls, reporting controls, or
category analysis cards.

The Categories page renders a responsive grid. Each category card contains:

- One contiguous identity group: symbol, color, localized name, and active,
  unarchived subscription count.
- Estimated monthly average in the account reporting currency when conversion is
  complete, plus the annualized estimate as restrained secondary text.
- The earliest next scheduled renewal with subscription name, original-currency
  amount, and date.
- Up to three active subscription rows ordered by next billing date. Each row shows
  name, original-currency amount, recurrence, and next date rather than only a logo.
- A `View all` action when the category contains subscriptions beyond the preview.

`Uncategorized` is a virtual group derived from `category_id = NULL`; it is not a
persisted category and cannot be edited. Selecting a category navigates to
`/subscriptions?categoryId=<id>&status=active`. Selecting `Uncategorized` uses
`categoryId=none`. The first release does not add `/categories/:id`; the filtered
Subscriptions route is the detail view.

The browse route shows only groups with at least one active, unarchived subscription,
ordered by saved category position with `Uncategorized` last. Empty saved categories
remain visible in Settings rather than occupying browse-page space. If no group has an
active subscription, show one concise empty state with `Add subscription` as the
primary action and `Manage categories` as the secondary action. The initial page has
no Day, Week, Month, Year, or currency selector: its monthly, annual, and next-renewal
fields have fixed, explicit meanings.

The card surface is not one large interactive wrapper around nested links. The
category title and `View all` navigate to the filtered list, while each subscription
preview may link to its own detail route. This preserves valid semantics, predictable
keyboard order, and distinct accessible names.

The page reuses one request each for categories, the 30-day Dashboard response, and
active, unarchived subscriptions, then joins them client-side. It must not issue one
request per category and does not require a new API endpoint. A partial FX state keeps
original-currency subscription rows visible and replaces only unavailable converted
estimates with the existing concise FX state.

Cards use the existing surface system with category color as a restrained accent or
tint. They do not use category photographs, glass overlays, uploaded media, remote
images, or decorative backgrounds. Wide layouts use two columns when the cards retain
comfortable reading width; narrow layouts use one column without hiding fields.

### 5.2 Category Settings

The page hierarchy becomes:

1. Page title and one `Add category` action.
2. Compact list of the user's saved categories.
3. One concise empty state when no category exists.

The full common-category catalog is removed from the page body. Selecting
`Add category` opens one dialog containing:

- A compact `Common categories` section.
- A `Create category` path for a blank draft.
- Name, color, and symbol fields in the same editor used for later edits.
- One primary `Add category` button and one `Cancel` action.

Choosing a common category only prefills the draft. It does not save until `Add
category` is selected. Suggestions whose normalized names already exist are omitted
rather than shown disabled.

### 5.3 Payment Method Settings

Payment Method Settings uses the same hierarchy and dialog pattern:

1. Page title and one `Add payment method` action.
2. Compact saved-method list.
3. Common choices inside the add dialog, not as a permanent page section.
4. One reviewed editor for name, kind, safe label, and symbol.

Choosing a common method prefills the editor. The primary action remains `Add payment
method`; there is no `Use preset` step or informational notice that a draft is ready.

### 5.4 Subscription Create and Edit

Category and payment-method association fields use the same compact pattern:

- The closed field shows the current selection or the explicit empty value.
- Opening it shows saved resources first.
- Common choices not already saved appear in a second section.
- `Create category` or `Create payment method` is the single final action.
- The current `Manage in Settings` link and leave-page confirmation are removed from
  the picker. Management remains available through Settings navigation.
- Selecting a saved row assigns it immediately and closes the panel.
- Selecting a common or custom choice opens the compact editor. `Add and select`
  creates the ordinary tenant row and assigns its returned UUID.

The existing side effect remains explicit: a successfully added resource remains
available even if the subscription form is later cancelled. The dialog text states
this once only when needed; it is not repeated on every suggestion row.

### 5.5 Layout and Accessibility

- Saved lists use a two-column grid: `minmax(0, 1fr) auto`.
- The identity cell contains icon, name, and optional safe secondary label as one
  contiguous group.
- Ordinary rows target 44–52 CSS pixels, not the current sparse table height.
- A search field appears only when saved plus common choices exceed ten.
- The entire option row is the selection target; no checkbox is used for a
  single-choice association.
- Dialog focus, Escape behavior, keyboard traversal, visible focus, and trigger-focus
  return follow the existing accessible component rules.
- Wide layouts may use two compact suggestion columns. Narrow layouts use one column
  without changing the reading order.

### 5.6 Onboarding

Remove the bulk template wall and delayed `Add selected` action from onboarding.
Onboarding may offer a short group of common category suggestions, but each selected
item must have a visible selected state and the final action must say `Add categories`
once. Starting empty remains equally prominent. Payment methods continue to be added
only when needed.

## 6. Information and Action Pruning

Keep a control only when it changes state or navigates to a useful next step.

Remove from the normal experience:

- Language-mismatch notices and language-copy buttons.
- Provider-unavailable warnings in Profile Settings.
- Reminder toggles that cannot be enabled in the current deployment.
- Repeated `Ready to add`, duplicate-state labels, and disabled suggestion rows.
- Settings links inside resource selectors.
- Bar/Pie segmented controls and their `localStorage` display preference.
- Repeated FX source/date lines in every chart card.
- Permanent success notices that merely repeat the last button label.

Keep or show only when actionable:

- Validation and save failures adjacent to the affected form.
- A system email suspension only when at least one saved reminder choice is affected,
  with one clear operator-resolution path.
- A single Dashboard FX disclosure for all converted estimates and charts.
- A concise chart-unavailable state when conversion is incomplete.

When the email capability is disabled, reminder controls are omitted for a
subscription that has no saved opt-in; the Email language preference remains visible.
If a previously enabled subscription is encountered after capability is disabled,
show its saved state and keep `Turn off reminder` usable, but do not expose an unusable
enable action. Once capability is enabled, the normal per-subscription opt-in and
account defaults appear without a deployment warning.

## 7. Dashboard Chart Revision

### 7.1 Separate Visualizations

Remove the chart-mode toggle. The Dashboard renders four visible chart panels:

1. `Category amounts` — horizontal Bar chart.
2. `Category share` — Pie chart, visually allowed to use a donut center.
3. `Payment method amounts` — horizontal Bar chart.
4. `Payment method share` — Pie chart, visually allowed to use a donut center.

Each category or payment-method section has one compact header, one shared FX/status
line, the Bar and Pie panels, and one authoritative compact data table. Do not repeat
the same header, FX text, or explanatory paragraph inside both chart panels.

### 7.2 Responsive Layout

- At wide widths, Bar and Pie panels for one breakdown sit side by side.
- Category and payment-method sections stack vertically so each pair has enough width.
- At narrow widths, Bar then Pie then the compact table stack in that order.
- The Bar chart grows with the number of displayed groups within a documented maximum.
- The Pie chart uses a fixed, bounded height and a compact legend.

### 7.3 Sparse and Failure States

- One positive group renders one Bar and a 100% Pie. It is not replaced with a
  text-only special state.
- Multiple groups use the same reporting-currency monthly estimates in both charts.
- Zero-valued groups may remain in the text table but do not create Pie slices.
- No subscriptions produces one compact empty state for the entire breakdown section,
  not four empty cards.
- Incomplete FX conversion hides both amount charts, names the missing currencies once,
  and preserves the original-currency table. It never substitutes subscription count
  under an amount title.
- Stale but complete FX may render with one shared stale-rate disclosure.

### 7.4 Correctness and Accessibility

- Bar length, Pie angle, tooltip amount, visible amount, share, and text-table value
  derive from the same converted integer-micro-unit model.
- Both visualizations remain estimates and never imply observed payments.
- The compact HTML table is the authoritative screen-reader and no-chart equivalent.
- Charts have unique accessible names that state dimension, metric, and reporting
  currency.
- Color is never the only mapping; labels and symbols remain visible.
- Animation remains disabled and forced-color/reduced-motion modes remain supported.

## 8. Email Deployment and Activation

### 8.1 Architecture Stays Small

Email activation uses the implementation already in the repository:

```text
Hourly Cron on the full-stack Worker
  -> recurrence-based reminder planner
  -> D1 delivery outbox and idempotency ledger
  -> EmailSender port
  -> Cloudflare send_email binding in production only
```

Do not add a second Worker, Queue, or browser-scheduled task for the initial owner and
friend pilot. The daily FX Cron and hourly reminder Cron remain independent branches
of the same `scheduled()` handler.

### 8.2 Fixed Recipient Contract

The application does not support a configurable reminder recipient.

- Every reminder is addressed to the account's current `primary_email`, sourced from
  the verified Cloudflare Access identity.
- D1, the public API, subscription records, and archives contain no recipient override
  or alternate notification-address field.
- Profile and reminder screens contain no editable recipient input. When confirmation
  is useful, the account email is rendered as plain text rather than a disabled form
  control.
- A subscription can control whether and when a reminder is sent, but never who
  receives it.
- For the Free pilot, the operator adds that exact account email as a Cloudflare Email
  Service destination and the account owner completes Cloudflare's verification.
  Access approval and Email Service destination verification remain separate
  operator checks.
- An Access identity email change fails closed: reminder preferences stay saved, but
  delivery remains paused until the new exact address is verified and the private
  binding destination restriction is updated.

This removes recipient management, verification UX, and another source of private
data from the application while matching the invite-only account model.

### 8.3 Deployment Paths

Cloudflare currently exposes two relevant outbound boundaries:

| Path                       | Recipients                                                       | Account plan                                                    | Phase 5 use                                    |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Verified-destination pilot | Account-level destination addresses that each recipient verifies | Workers Free or Paid; these verified-destination sends are free | Approved for the owner and a few friends       |
| General outbound sending   | Arbitrary recipients                                             | Requires an explicit Workers Paid upgrade                       | Deferred until the pilot outgrows verification |

Configuration does not silently upgrade the Cloudflare account. General outbound
sending must remain blocked until the operator deliberately changes the account plan
and reviews the current pricing. The tracked repository keeps email disabled and
contains example addresses only.

### 8.4 Operator Setup

The activation workstream is:

1. Keep the application and D1 backup usable with email disabled.
2. Onboard a dedicated sender subdomain such as `notify.example.com` in Cloudflare
   Email Service. Keep the real domain out of tracked configuration.
3. Let Cloudflare add or verify the required sender DNS records.
4. Add the owner as a verified destination address. Add a friend only after that
   friend accepts Cloudflare's verification message.
5. Add a production-only `send_email` binding named `EMAIL` in ignored
   `wrangler.local.jsonc`, restricted with both `allowed_sender_addresses` and
   `allowed_destination_addresses`.
6. Set the existing production mode, sender address, and a positive provider
   configuration revision. Increment the revision whenever sender or destination
   restrictions change.
7. Apply `0007_split_interface_email_locales.sql` and deploy only after backup, dry
   run, and privacy checks pass.

The canonical example and exact private-configuration boundary remain in
[Self-hosting, Section 14](./self-hosting.md#14-optional-renewal-email--implemented-and-provider-gated).

### 8.5 Required First-run Sequence

1. Run all local reminder tests with the deterministic fake sender.
2. Before enabling any subscription, manually invoke the local scheduled route once:

   ```text
   /cdn-cgi/handler/scheduled?cron=5+*+*+*+*&format=json
   ```

3. Confirm a successful no-send result and privacy-safe zero-attempt counters.
4. Deploy production with the provider configured but every subscription reminder
   still disabled.
5. Observe one normal production hourly run with no attempted delivery.
6. Enable one operator-owned subscription whose reminder window is testable, then
   verify one real delivery and its coarse D1 state.
7. Inspect logs for counts and stable codes only; no recipient, subscription name,
   subject, body, or provider response body may appear.
8. Add friend destinations and enable their subscription choices only after the owner
   path is accepted.

The development scheduled endpoint is the required manual trigger. Production uses a
normal Cron event; do not add an unauthenticated HTTP endpoint merely to create a
"run now" button.

### 8.6 Rollback

- Set the provider mode back to `disabled` and deploy. Leaving the hourly Cron present
  is safe because it records a skipped capability state.
- Remove the binding after disabling the mode if credential or permission isolation
  requires it.
- Preserve user preferences and delivery rows so a rollback cannot resend an
  occurrence already marked sent or unknown.
- Do not delete the locale migration or copy production user tables between D1
  databases as a rollback technique.

## 9. Implemented Contract Changes

| Area                  | Before Phase 5                                | Current contract                                                        |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| User locale           | `preferredLocale` drives UI and email         | `interfaceLocale` and `emailLocale`                                     |
| D1 locale             | `preferred_locale`                            | `preferred_locale` for interface plus `email_locale`                    |
| Reminder revision     | UI language changes invalidate email          | Only email-language changes invalidate email                            |
| Archive               | V3 `preferredLocale`                          | Runtime V4 with both locale fields; V3 is offline input only            |
| Resource wording      | Preset-oriented                               | Saved, Common, Create, Add and select                                   |
| Settings suggestions  | Permanent sparse lists                        | Suggestions inside one add dialog                                       |
| Category navigation   | Settings, filters, and Dashboard breakdowns   | Top-level browse route plus separate Settings management                |
| Chart display         | One mode at a time; single group has no chart | Bar and Pie both visible; one group renders 100%                        |
| Email availability UI | Global warning and disabled controls          | Normal UI hides unavailable actions; operator docs own deployment state |

The focused contracts in `data-model.md`, `api-contract.md`, `import-export.md`,
`ui-flow.md`, `architecture.md`, `self-hosting.md`, and
`environments-and-deployment.md` describe the resulting behavior.

## 10. Implementation and Activation Sequence

### Phase A: Locale Contract — Implemented

1. Cover the locale migration with a populated upgrade-path rehearsal and record an
   exact production recovery point before applying it remotely.
2. Add the two domain/API fields and update repository mapping.
3. Update Profile Settings with independent fields and remove mismatch/provider
   notices.
4. Render reminder envelopes from Email language only.
5. Move the runtime archive to V4; transform any retained private V3 archive offline
   before it is imported or transferred.

### Phase B: Resource UX — Implemented

1. Add component tests that reproduce the wide-row layout defect.
2. Replace settings preset sections with one add dialog per resource type.
3. Add the top-level Categories route and responsive navigation entry.
4. Compose category cards from the existing category, Dashboard, and filtered
   subscription requests without per-category calls.
5. Link category selection to the existing Subscriptions query filters and keep
   management in Settings.
6. Replace user-facing preset copy with the approved outcome language.
7. Simplify subscription association fields and remove Settings navigation from them.
8. Reuse the same editors and ordinary tenant-owned resource APIs.
9. Simplify onboarding to avoid the permanent bulk template wall.

### Phase C: Separate Charts — Implemented

1. Remove chart view state, segmented controls, and local-storage preferences.
2. Split the present chart renderer into explicit Bar and Pie components.
3. Render both for one or more positive groups.
4. Consolidate FX disclosure and the accessible text table per breakdown.
5. Verify wide, narrow, sparse, stale-FX, and unavailable-FX states.

### Phase D: Email Activation — Operator-gated

1. Keep tracked configuration disabled and examples anonymous.
2. Complete sender-domain and verified-destination setup privately.
3. Execute the fake no-send manual trigger before production activation.
4. Deploy with every real subscription reminder off.
5. Verify one operator delivery before allowing friend reminders.
6. Record a private rollback and recovery checkpoint.

## 11. Acceptance Criteria

The repository implementation satisfies the product and contract items below. The
verified-destination delivery and provider-disable bullets remain hosted operator
acceptance gates and are not claimed complete by source implementation alone.

- Profile Settings contains separate Interface language and Email language fields and
  no mismatch warning or copy-language button.
- Changing Interface language does not change Email language or reminder revision.
- No user-facing screen contains `Use preset`, `Ready to add`, or `Create from preset`.
- Category and payment-method settings no longer render a wide permanent suggestion
  table or multi-select checkbox wall.
- `/categories` is a primary browse route distinct from `/settings/categories`, and
  the page header provides the only direct management action.
- Every category card exposes identity, active count, explicit estimated monthly and
  annual values when available, next renewal, and useful subscription previews; it
  never relies on a photograph to carry meaning.
- The browse route omits empty groups, provides an actionable all-empty state, uses
  fixed clearly labelled metrics, and avoids nested interactive-card semantics.
- Category drill-down reuses `/subscriptions?categoryId=...` or `categoryId=none`,
  and category loading performs no per-category network requests.
- Subscription Create and Edit can select a saved row, add a common choice, or create
  a custom resource with one predictable primary action.
- Resource option identity stays contiguous at wide and narrow viewports, and every
  option remains keyboard accessible.
- Category and payment-method sections each show separate Bar and Pie charts without a
  toggle whenever at least one positive amount group exists.
- A single `Uncategorized` or `No payment method` group displays one Bar and a 100%
  Pie instead of a text-only replacement.
- The four charts, tooltips, shares, and compact tables agree for known fixtures.
- Disabled email causes no normal Profile warning and exposes no unusable reminder
  switch; an already-enabled saved preference can still be turned off.
- Reminder recipients always equal the current Access account email; no UI, API,
  archive, or per-subscription recipient override exists.
- The free verified-destination path sends one localized operator reminder only after
  the manual no-send check, normal production no-send run, and explicit opt-in.
- A provider disable rollback stops new attempts without deleting preference or
  delivery history.
- Local, CI, and public repository configuration cannot send a real email or expose
  private sender and recipient values.

## 12. Non-goals

- No automatic email opt-in based on amount, currency, payment method, or manual
  renewal.
- No observed-payment or actual-spend ledger.
- No public registration or in-app friend administration.
- No arbitrary-recipient paid-email activation without an explicit operator decision.
- No second Worker, Queue, or new scheduling service for the pilot.
- No uploaded icons, remote logos, category photographs, remote category media, or
  preset provenance stored on tenant resources.
- No category-specific detail route or category analytics endpoint in the first
  category-overview release.
- No projected historical time-series chart in this corrective phase.

## 13. Official References

- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)
- [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Cloudflare send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Cloudflare sender-domain setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Cloudflare verified destination addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/#destination-addresses)
- [Cloudflare Cron Trigger local testing](https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers-locally)

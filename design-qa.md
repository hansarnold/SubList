# Design QA

Date: 2026-08-23

## Reference comparison

- Compared `/dashboard` at 1487 × 1058 against `docs/assets/open-sublists-dashboard-prototype-web.png` in a single side-by-side image.
- Compared `/subscriptions` at 1487 × 1058 against `docs/assets/open-sublists-subscriptions-prototype-web.png` in the same comparison pass.
- Verified the shared responsive web shell, navigation hierarchy, summary surfaces, spacing, card treatment, filters, typography, and primary action placement.
- Differences in product names, amounts, category counts, service artwork, and record density are expected because the references contain directional mock data. The implementation also retains the required archived-state filter.

## Responsive verification

- Wide website: 1487 × 1058.
- Tablet-width website: 900 × 800.
- Narrow website: 390 × 844.
- Verified sidebar-to-mobile-navigation transition, single-column subscription cards, readable per-currency totals, filter disclosure, fixed mobile navigation, and form actions above the mobile navigation.
- Verified the tablet form preview stays below the fixed web header.

## Interaction verification

- Dashboard 7-day and 30-day controls.
- Subscription search with multi-character typing and debounced URL/API updates.
- Status, category, payment-method, currency, and archived filters.
- Grid and compact-list views.
- Subscription detail and edit routes.
- Archive, archived-only filtering, unarchive, and restored list state.
- Create-form validation, first-invalid-field focus, and error `aria-describedby` wiring.
- Profile, categories, payment methods, data import/export, and local sign-out explanation.
- English and Simplified Chinese interface switching.

## Issues corrected during QA

- Kept subscription results mounted while search and filter queries refresh.
- Debounced search input so typing is not interrupted by request churn.
- Prevented narrow summary currency amounts from truncating.
- Removed duplicate wide-layout Add Subscription actions.
- Positioned sticky form content around the fixed responsive navigation.
- Connected form errors to controls and focused the first invalid field.
- Removed the non-functional Cloudflare Access sign-out control from local development.

final result: passed

# OpenSubLists Billing Rules

> Status: MVP specification  
> Last updated: 2026-08-23  
> Purpose: Define deterministic recurrence and reporting behavior before implementation

## 1. Goals

Billing behavior must be:

- Deterministic across browsers and Worker locations.
- Independent of JavaScript `Date` overflow behavior.
- Correct for month ends and leap years.
- Testable without D1, Hono, React, or the Workers runtime.
- Based on calendar dates in the user's time zone rather than UTC instants.

The implementation belongs in a pure TypeScript domain module.

## 2. Terminology

| Term | Meaning |
| --- | --- |
| Local today | The current `YYYY-MM-DD` date in the user's configured IANA time zone |
| Billing anchor | A known valid occurrence of the recurring charge |
| Recurrence unit | `day`, `week`, `month`, or `year` |
| Recurrence count | Number of recurrence units between charges |
| Calendar-day mode | Preserve the anchor day and clamp only when a target month is shorter |
| End-of-month mode | Always use the final calendar day of each target month |
| Next billing date | The first valid occurrence on or after local today |

The billing anchor does not need to be the first-ever payment. Any known occurrence is sufficient.

## 3. Date Representation

- Domain inputs and outputs use ISO calendar-date strings in `YYYY-MM-DD` form.
- Calendar calculations must use a date-only representation.
- UTC timestamps are not used to advance billing schedules.
- The time zone is used only to determine local today and, in a later reminder feature, the delivery instant.
- Daylight-saving time changes do not alter a date-only billing schedule.

Invalid calendar dates such as `2026-02-30` are rejected even if they match the string pattern.

## 4. Inclusive Next-occurrence Rule

The next billing date is the earliest schedule occurrence greater than or equal to local today.

```text
Occurrence: 2026-08-23
Local today: 2026-08-23
Next billing date: 2026-08-23
```

This inclusive rule ensures a charge due today appears in upcoming charges.

## 5. Daily Recurrence

For a recurrence count `n`, occurrences are:

```text
anchor + k × n calendar days, where k is an integer
```

The next occurrence uses the smallest `k >= 0` whose date is on or after local today. If the anchor is in the past, the implementation may calculate `k` directly from the calendar-day difference; it must not loop once per historical occurrence.

## 6. Weekly Recurrence

Weekly recurrence is equivalent to a fixed number of calendar days:

```text
anchor + k × recurrence_count × 7 calendar days
```

The weekday is inherited from the anchor. Time-zone offset or daylight-saving changes do not move it to another weekday.

## 7. Monthly Recurrence

Monthly schedules advance by whole calendar months from the original anchor. They never advance from a previously clamped result.

### 7.1 Calendar-day Mode

For every `n` months:

1. Calculate the target year and month as `anchor month + k × n`.
2. Retain the original anchor day.
3. Use the smaller of the anchor day and the target month's final day.

Example for an anchor of 2026-01-31:

```text
2026-01-31
2026-02-28
2026-03-31
2026-04-30
```

February 28 does not become the new anchor.

### 7.2 End-of-month Mode

For every `n` months, choose the final day of each target month.

Example for an anchor of 2026-02-28:

```text
2026-02-28
2026-03-31
2026-04-30
2026-05-31
```

End-of-month mode is valid only for monthly schedules. The create and edit UI should expose it as an advanced toggle.

### 7.3 Difference Between the Modes

An anchor of February 28 is ambiguous without an explicit mode:

```text
calendar_day  → March 28
end_of_month  → March 31
```

The application must not infer end-of-month mode solely because an entered date happens to be the final day of its month.

## 8. Yearly Recurrence

For every `n` years:

1. Add `k × n` to the original anchor year.
2. Retain the original month and day when valid.
3. Clamp the day to the target month's final day when necessary.

For a February 29 anchor:

```text
2024-02-29
2025-02-28
2026-02-28
2027-02-28
2028-02-29
```

The original February 29 anchor remains authoritative and is restored in leap years.

## 9. Schedule State Rules

### 9.1 Active

- Participates in next-billing calculations.
- Has a non-null `next_billing_on`.
- Participates in reporting unless archived.

### 9.2 Cancelled

- Produces no future occurrences.
- Has `next_billing_on = NULL`.
- Remains available for history and possible reactivation.

### 9.3 Archived

- Archiving does not modify the recurrence rule or lifecycle status.
- Archived subscriptions are excluded from dashboard totals and upcoming charges by default.
- Unarchiving an active subscription recalculates `next_billing_on` before returning it to normal views.

### 9.4 Reactivation

Reactivation changes a cancelled subscription to active and calculates the first schedule occurrence on or after local today from the original anchor.

The MVP does not support a resume date or a pause period.

## 10. Time-zone Changes

When a user changes their time zone:

- Stored billing anchors remain unchanged calendar dates.
- The application recalculates local today in the new time zone.
- Active subscriptions reconcile `next_billing_on` against the new local today.
- A time-zone change may move an occurrence between "today" and "past" near midnight, but it never changes the underlying recurrence sequence.

## 11. Materialized Next Billing Date

`next_billing_on` is a materialized query field. The recurrence rule remains authoritative.

### 11.1 Create or Schedule Update

The server calculates and persists `next_billing_on` in the same operation that writes the schedule.

### 11.2 Read Reconciliation

If an active record contains a `next_billing_on` earlier than local today:

1. Recalculate it from the original anchor and recurrence rule.
2. Use the corrected value in the response.
3. Persist all corrections through a D1 batch after the response model is built.

### 11.3 Scheduled Reconciliation

Future reminder processing must reconcile stale next-billing dates before selecting deliveries.

### 11.4 Client Trust Boundary

The client may preview a calculation, but the server always recalculates it. Create and update payloads do not accept `nextBillingOn`.

## 12. Amount and Reporting Rules

### 12.1 Stored Amount

The subscription amount represents one recurrence occurrence and is stored as integer micro-units.

### 12.2 Actual Upcoming Cash Flow

Upcoming-charge totals sum the stored amount for occurrences inside the requested date window. They do not use monthly or annual normalization.

### 12.3 Annualized Estimates

Normalization uses the following exact ratios:

```text
day:   amount × 146097 / (400 × recurrence_count)
week:  amount × 146097 / (2800 × recurrence_count)
month: amount × 12 / recurrence_count
year:  amount / recurrence_count
```

`146097 / 400` is exactly 365.2425 days per Gregorian year.

### 12.4 Monthly Estimates

```text
monthly estimate = annualized estimate / 12
```

### 12.5 Rounding

- Domain calculations retain exact rational values using integer arithmetic.
- TypeScript may use `bigint` internally for intermediate calculations.
- Values are rounded only at the final response or display boundary.
- Persisted D1 integers remain within JavaScript `Number.MAX_SAFE_INTEGER`; `bigint` is not passed to the D1 Binding API.
- Totals are grouped and rounded after aggregation, not once per subscription.

### 12.6 Multiple Currencies

- Values are grouped by currency.
- Different currencies are never added together in the MVP.
- No implicit exchange rate is applied.
- Normalized values are labeled as estimates.

## 13. Required Test Matrix

| Case | Anchor | Rule | Local today | Expected next billing |
| --- | --- | --- | --- | --- |
| Due today | 2026-08-23 | Every day | 2026-08-23 | 2026-08-23 |
| Every two days | 2026-08-20 | Every 2 days | 2026-08-23 | 2026-08-24 |
| Every two weeks | 2026-08-10 | Every 2 weeks | 2026-08-23 | 2026-08-24 |
| Month-end clamp | 2026-01-31 | Monthly, calendar day | 2026-02-01 | 2026-02-28 |
| Inclusive clamp date | 2026-01-31 | Monthly, calendar day | 2026-02-28 | 2026-02-28 |
| Restore anchor day | 2026-01-31 | Monthly, calendar day | 2026-03-01 | 2026-03-31 |
| February calendar day | 2026-02-28 | Monthly, calendar day | 2026-03-01 | 2026-03-28 |
| February end of month | 2026-02-28 | Monthly, end of month | 2026-03-01 | 2026-03-31 |
| Every three months | 2026-01-31 | Every 3 months | 2026-04-01 | 2026-04-30 |
| Leap-day yearly | 2024-02-29 | Yearly | 2025-02-01 | 2025-02-28 |
| Leap-day after occurrence | 2024-02-29 | Yearly | 2025-03-01 | 2026-02-28 |
| Future anchor | 2026-12-01 | Monthly | 2026-08-23 | 2026-12-01 |
| Cancelled | Any | Any | Any | `NULL` |

Additional property tests should verify:

- Returned occurrences are never before local today.
- Returned occurrences belong to the defined sequence.
- Projecting an inclusive date window returns every occurrence in order and none after the window end.
- A short-interval subscription can contribute multiple upcoming charges and the currency total includes each occurrence exactly once.
- Increasing local today never returns an earlier occurrence.
- Monthly calculations never drift from the original anchor.
- Yearly February 29 calculations return to February 29 in leap years.
- Large historical gaps complete without occurrence-by-occurrence loops.

## 14. Invalid Inputs

Reject:

- Invalid or non-canonical calendar dates.
- Recurrence counts outside `1..1200`.
- Unknown recurrence units.
- End-of-month mode for non-monthly schedules.
- Amounts outside `0..Number.MAX_SAFE_INTEGER` micro-units.
- Unsupported currency codes.
- Attempts to set `nextBillingOn` from the client.

## 15. Explicit Non-goals

- Trial periods and introductory offers.
- Partial billing periods or prorating.
- Actual payment transaction reconciliation.
- Pause periods and automatic resumption.
- Business-day adjustment for weekends or holidays.
- Provider-specific billing calendars.
- Exchange-rate conversion.

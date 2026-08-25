import { describe, expect, it } from "vitest";

import {
  effectiveReminderDaysBefore,
  nextReminderPlanOnOrAfter,
  reminderPlanForBilling,
  resolveReminderWindow,
  type RecurrenceRule,
} from "../../../src/domain";

const daily: RecurrenceRule = {
  unit: "day",
  count: 1,
  anchorOn: "2026-01-01",
  anchorMode: "calendar_day",
};

describe("renewal reminder planning", () => {
  it("keeps opt-in separate while resolving an inherited lead time", () => {
    expect(effectiveReminderDaysBefore(7, null)).toBe(7);
    expect(effectiveReminderDaysBefore(7, 0)).toBe(0);
    expect(() => effectiveReminderDaysBefore(7, 366)).toThrowError(/between 0 and 365/);
  });

  it("finds a future reminder for short recurrences and long lead times", () => {
    expect(nextReminderPlanOnOrAfter(daily, 7, "2026-08-24")).toEqual({
      planningOn: "2026-08-24",
      billingOn: "2026-08-31",
      effectiveDaysBefore: 7,
    });
  });

  it("rejects a billing date that is not an authoritative occurrence", () => {
    const everyTwoDays = { ...daily, count: 2 };
    expect(() => reminderPlanForBilling(everyTwoDays, "2026-08-24", 1)).toThrowError(
      /not an occurrence/,
    );
  });

  it.each([
    [
      "weekly short interval",
      { ...daily, unit: "week" as const, anchorOn: "2026-08-03" },
      14,
      "2026-08-24",
      { planningOn: "2026-08-24", billingOn: "2026-09-07", effectiveDaysBefore: 14 },
    ],
    [
      "month-end clamp",
      { ...daily, unit: "month" as const, anchorOn: "2026-01-31" },
      7,
      "2026-02-20",
      { planningOn: "2026-02-21", billingOn: "2026-02-28", effectiveDaysBefore: 7 },
    ],
    [
      "leap-day yearly recurrence",
      { ...daily, unit: "year" as const, anchorOn: "2024-02-29" },
      7,
      "2025-02-20",
      { planningOn: "2025-02-21", billingOn: "2025-02-28", effectiveDaysBefore: 7 },
    ],
    [
      "future known anchor",
      { ...daily, unit: "month" as const, anchorOn: "2026-12-01" },
      7,
      "2026-08-24",
      { planningOn: "2026-08-25", billingOn: "2026-09-01", effectiveDaysBefore: 7 },
    ],
  ])(
    "plans %s from the recurrence source of truth",
    (_name, recurrence, lead, earliest, expected) => {
      expect(nextReminderPlanOnOrAfter(recurrence, lead, earliest)).toEqual(expected);
    },
  );
});

describe("renewal reminder local windows", () => {
  it("resolves ordinary whole-hour local time and next local midnight", () => {
    expect(
      resolveReminderWindow({
        planningOn: "2026-08-24",
        localTime: "09:00",
        timeZone: "Asia/Shanghai",
      }),
    ).toEqual({
      planningOn: "2026-08-24",
      intendedSendAt: Date.parse("2026-08-24T01:00:00.000Z"),
      expiresAt: Date.parse("2026-08-24T16:00:00.000Z"),
    });
  });

  it("uses compatible disambiguation for a DST spring gap", () => {
    const window = resolveReminderWindow({
      planningOn: "2026-03-08",
      localTime: "02:00",
      timeZone: "America/New_York",
    });
    expect(window.intendedSendAt).toBe(Date.parse("2026-03-08T07:00:00.000Z"));
    expect(window.expiresAt).toBe(Date.parse("2026-03-09T04:00:00.000Z"));
  });

  it("uses the earlier offset for a DST overlap", () => {
    const window = resolveReminderWindow({
      planningOn: "2026-11-01",
      localTime: "01:00",
      timeZone: "America/New_York",
    });
    expect(window.intendedSendAt).toBe(Date.parse("2026-11-01T05:00:00.000Z"));
    expect(window.expiresAt).toBe(Date.parse("2026-11-02T05:00:00.000Z"));
  });

  it.each([
    [
      "UTC-12 local midnight",
      "Etc/GMT+12",
      "00:00",
      "2026-08-24T12:00:00.000Z",
      "2026-08-25T12:00:00.000Z",
    ],
    [
      "UTC+14 at 23:00",
      "Pacific/Kiritimati",
      "23:00",
      "2026-08-24T09:00:00.000Z",
      "2026-08-24T10:00:00.000Z",
    ],
    [
      "fractional UTC offset",
      "Asia/Kathmandu",
      "09:00",
      "2026-08-24T03:15:00.000Z",
      "2026-08-24T18:15:00.000Z",
    ],
  ])("resolves %s", (_name, timeZone, localTime, intended, expires) => {
    const window = resolveReminderWindow({ planningOn: "2026-08-24", localTime, timeZone });
    expect(window.intendedSendAt).toBe(Date.parse(intended));
    expect(window.expiresAt).toBe(Date.parse(expires));
  });
});

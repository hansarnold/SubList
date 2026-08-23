import { describe, expect, it } from "vitest";

import {
  calculateNextBillingOn,
  nextOccurrenceOnOrAfter,
  occurrenceAt,
  projectOccurrences,
  type RecurrenceRule,
} from "../../../src/domain";

function rule(
  anchorOn: string,
  unit: RecurrenceRule["unit"],
  count = 1,
  anchorMode: RecurrenceRule["anchorMode"] = "calendar_day",
): RecurrenceRule {
  return { anchorOn, unit, count, anchorMode };
}

describe("next billing occurrence", () => {
  it.each<[string, RecurrenceRule, string, string]>([
    ["due today", rule("2026-08-23", "day"), "2026-08-23", "2026-08-23"],
    ["every two days", rule("2026-08-20", "day", 2), "2026-08-23", "2026-08-24"],
    ["every two weeks", rule("2026-08-10", "week", 2), "2026-08-23", "2026-08-24"],
    ["month-end clamp", rule("2026-01-31", "month"), "2026-02-01", "2026-02-28"],
    ["inclusive clamp date", rule("2026-01-31", "month"), "2026-02-28", "2026-02-28"],
    ["restore anchor day", rule("2026-01-31", "month"), "2026-03-01", "2026-03-31"],
    ["February calendar day", rule("2026-02-28", "month"), "2026-03-01", "2026-03-28"],
    [
      "February end of month",
      rule("2026-02-28", "month", 1, "end_of_month"),
      "2026-03-01",
      "2026-03-31",
    ],
    ["every three months", rule("2026-01-31", "month", 3), "2026-04-01", "2026-04-30"],
    ["leap-day yearly", rule("2024-02-29", "year"), "2025-02-01", "2025-02-28"],
    ["leap-day after occurrence", rule("2024-02-29", "year"), "2025-03-01", "2026-02-28"],
    ["future anchor", rule("2026-12-01", "month"), "2026-08-23", "2026-12-01"],
  ])("handles %s", (_name, recurrence, today, expected) => {
    expect(nextOccurrenceOnOrAfter(recurrence, today)).toBe(expected);
  });

  it("returns null for a cancelled subscription", () => {
    expect(
      calculateNextBillingOn(rule("2026-08-23", "month"), "2026-08-23", "cancelled"),
    ).toBeNull();
  });

  it("does not drift monthly schedules from a clamped occurrence", () => {
    const recurrence = rule("2026-01-31", "month");
    expect(occurrenceAt(recurrence, 0)).toBe("2026-01-31");
    expect(occurrenceAt(recurrence, 1)).toBe("2026-02-28");
    expect(occurrenceAt(recurrence, 2)).toBe("2026-03-31");
    expect(occurrenceAt(recurrence, 3)).toBe("2026-04-30");
  });

  it("restores February 29 in later leap years", () => {
    const recurrence = rule("2024-02-29", "year");
    expect(occurrenceAt(recurrence, 1)).toBe("2025-02-28");
    expect(occurrenceAt(recurrence, 4)).toBe("2028-02-29");
  });

  it("handles large historical gaps directly", () => {
    expect(nextOccurrenceOnOrAfter(rule("0001-01-01", "day", 1_200), "9000-01-01")).toBe(
      "9003-03-30",
    );
  });
});

describe("occurrence projection", () => {
  it("returns every occurrence in an inclusive window", () => {
    expect(projectOccurrences(rule("2026-08-20", "day", 2), "2026-08-23", "2026-08-30")).toEqual([
      "2026-08-24",
      "2026-08-26",
      "2026-08-28",
      "2026-08-30",
    ]);
  });

  it("returns an empty projection when the anchor is after the window", () => {
    expect(projectOccurrences(rule("2026-12-01", "month"), "2026-08-01", "2026-08-31")).toEqual([]);
  });

  it("returns the final supported occurrence without advancing past year 9999", () => {
    expect(projectOccurrences(rule("9998-12-31", "year", 2), "9998-01-01", "9999-12-31")).toEqual([
      "9998-12-31",
    ]);
  });

  it("enforces a projection safety limit", () => {
    expect(() =>
      projectOccurrences(rule("2026-01-01", "day"), "2026-01-01", "2026-01-03", {
        maxOccurrences: 2,
      }),
    ).toThrowError(/safety limit/);
  });

  it("rejects invalid schedules and windows", () => {
    expect(() =>
      nextOccurrenceOnOrAfter(rule("2026-01-01", "year", 1, "end_of_month"), "2026-01-01"),
    ).toThrowError();
    expect(() =>
      projectOccurrences(rule("2026-01-01", "day"), "2026-02-01", "2026-01-01"),
    ).toThrowError();
  });

  it("is monotonic as local today increases", () => {
    const recurrence = rule("2020-01-31", "month");
    const localDates = ["2026-01-01", "2026-01-31", "2026-02-01", "2026-02-28", "2026-03-01"];
    const occurrences = localDates.map((date) => nextOccurrenceOnOrAfter(recurrence, date));

    expect(occurrences).toEqual([
      "2026-01-31",
      "2026-01-31",
      "2026-02-28",
      "2026-02-28",
      "2026-03-31",
    ]);
  });
});

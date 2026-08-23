import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  assertIanaTimeZone,
  calendarMonthWindow,
  calendarYearWindow,
  compareIsoCalendarDates,
  differenceInCalendarDays,
  isIsoCalendarDate,
  localTodayInTimeZone,
  parseIsoCalendarDate,
} from "../../../src/domain";

describe("ISO calendar dates", () => {
  it.each(["0001-01-01", "1900-02-28", "2000-02-29", "2024-02-29", "9999-12-31"])(
    "accepts real canonical date %s",
    (value) => {
      expect(isIsoCalendarDate(value)).toBe(true);
    },
  );

  it.each([
    "0000-01-01",
    "2026-2-01",
    "2026-02-30",
    "1900-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-01-01T00:00:00Z",
  ])("rejects invalid or non-canonical date %s", (value) => {
    expect(isIsoCalendarDate(value)).toBe(false);
    expect(() => parseIsoCalendarDate(value)).toThrowError();
  });

  it("adds and subtracts days without Date overflow behavior", () => {
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addCalendarDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addCalendarDays("1900-02-28", 1)).toBe("1900-03-01");
  });

  it("calculates signed day differences and ordering", () => {
    expect(differenceInCalendarDays("2024-02-28", "2024-03-01")).toBe(2);
    expect(differenceInCalendarDays("2024-03-01", "2024-02-28")).toBe(-2);
    expect(compareIsoCalendarDates("2026-08-23", "2026-08-24")).toBe(-1);
    expect(compareIsoCalendarDates("2026-08-23", "2026-08-23")).toBe(0);
  });

  it("rejects date arithmetic outside the supported range", () => {
    expect(() => addCalendarDays("0001-01-01", -1)).toThrowError();
    expect(() => addCalendarDays("9999-12-31", 1)).toThrowError();
  });

  it("derives complete local calendar month and year windows", () => {
    expect(calendarMonthWindow("2024-02-23")).toEqual({
      startsOn: "2024-02-01",
      endsOn: "2024-02-29",
    });
    expect(calendarYearWindow("2026-08-23")).toEqual({
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    });
  });
});

describe("local dates in IANA time zones", () => {
  it("derives local today from a fixed instant", () => {
    const instant = new Date("2026-08-23T16:30:00.000Z");

    expect(localTodayInTimeZone("UTC", instant)).toBe("2026-08-23");
    expect(localTodayInTimeZone("Asia/Shanghai", instant)).toBe("2026-08-24");
    expect(localTodayInTimeZone("America/Los_Angeles", instant)).toBe("2026-08-23");
  });

  it("accepts named IANA zones and rejects abbreviations or unknown zones", () => {
    expect(assertIanaTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(assertIanaTimeZone("UTC")).toBe("UTC");
    expect(() => assertIanaTimeZone("PST")).toThrowError();
    expect(() => assertIanaTimeZone("Mars/Olympus_Mons")).toThrowError();
  });
});

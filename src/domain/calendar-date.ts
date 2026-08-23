import { DomainValidationError } from "./errors";

export type IsoCalendarDate = string;

export interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1;
const MAX_YEAR = 9999;
const MAX_ORDINAL = daysBeforeYear(MAX_YEAR + 1) - 1;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new DomainValidationError(
      "INVALID_DATE",
      "Calendar years must be between 0001 and 9999.",
    );
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainValidationError("INVALID_DATE", "Calendar months must be between 01 and 12.");
  }

  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseIsoCalendarDate(value: string): CalendarDateParts {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw invalidDate();
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year < MIN_YEAR ||
    year > MAX_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw invalidDate();
  }

  return { year, month, day };
}

export function isIsoCalendarDate(value: string): value is IsoCalendarDate {
  try {
    parseIsoCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

export function assertIsoCalendarDate(value: string): IsoCalendarDate {
  parseIsoCalendarDate(value);
  return value;
}

export function formatIsoCalendarDate(parts: CalendarDateParts): IsoCalendarDate {
  const { year, month, day } = parts;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw invalidDate();
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function compareIsoCalendarDates(left: string, right: string): number {
  assertIsoCalendarDate(left);
  assertIsoCalendarDate(right);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function differenceInCalendarDays(from: string, to: string): number {
  return toOrdinal(parseIsoCalendarDate(to)) - toOrdinal(parseIsoCalendarDate(from));
}

export function addCalendarDays(date: string, days: number): IsoCalendarDate {
  if (!Number.isSafeInteger(days)) {
    throw new DomainValidationError(
      "INVALID_DATE",
      "The calendar-day offset must be a safe integer.",
    );
  }

  const targetOrdinal = toOrdinal(parseIsoCalendarDate(date)) + days;
  if (targetOrdinal < 0 || targetOrdinal > MAX_ORDINAL) {
    throw new DomainValidationError(
      "INVALID_DATE",
      "The resulting calendar date is outside 0001-01-01 through 9999-12-31.",
    );
  }

  return formatIsoCalendarDate(fromOrdinal(targetOrdinal));
}

export function assertIanaTimeZone(timeZone: string): string {
  const resemblesNamedTimeZone =
    timeZone === "UTC" || /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone);

  if (!resemblesNamedTimeZone) {
    throw invalidTimeZone(timeZone);
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw invalidTimeZone(timeZone);
  }

  return timeZone;
}

export function localTodayInTimeZone(
  timeZone: string,
  instant: Date | number = new Date(),
): IsoCalendarDate {
  assertIanaTimeZone(timeZone);
  const date = typeof instant === "number" ? new Date(instant) : instant;

  if (!Number.isFinite(date.getTime())) {
    throw new DomainValidationError("INVALID_DATE", "The supplied instant is invalid.");
  }

  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = numericDatePart(parts, "year");
  const month = numericDatePart(parts, "month");
  const day = numericDatePart(parts, "day");

  return formatIsoCalendarDate({ year, month, day });
}

function daysBeforeYear(year: number): number {
  const previousYear = year - 1;
  return (
    previousYear * 365 +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400)
  );
}

function toOrdinal(parts: CalendarDateParts): number {
  let ordinal = daysBeforeYear(parts.year);
  for (let month = 1; month < parts.month; month += 1) {
    ordinal += daysInMonth(parts.year, month);
  }

  return ordinal + parts.day - 1;
}

function fromOrdinal(ordinal: number): CalendarDateParts {
  let lowerYear = MIN_YEAR;
  let upperYear = MAX_YEAR;

  while (lowerYear <= upperYear) {
    const middleYear = Math.floor((lowerYear + upperYear) / 2);
    const yearStart = daysBeforeYear(middleYear);
    const nextYearStart = daysBeforeYear(middleYear + 1);

    if (ordinal < yearStart) {
      upperYear = middleYear - 1;
    } else if (ordinal >= nextYearStart) {
      lowerYear = middleYear + 1;
    } else {
      let dayOfYear = ordinal - yearStart;
      let month = 1;
      while (dayOfYear >= daysInMonth(middleYear, month)) {
        dayOfYear -= daysInMonth(middleYear, month);
        month += 1;
      }

      return { year: middleYear, month, day: dayOfYear + 1 };
    }
  }

  throw new DomainValidationError("INVALID_DATE", "The date ordinal is invalid.");
}

function numericDatePart(parts: Intl.DateTimeFormatPart[], type: "year" | "month" | "day"): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new DomainValidationError(
      "INVALID_DATE",
      "The local calendar date could not be determined.",
    );
  }

  return Number(value);
}

function invalidDate(): DomainValidationError {
  return new DomainValidationError("INVALID_DATE", "Use a real calendar date in YYYY-MM-DD form.");
}

function invalidTimeZone(timeZone: string): DomainValidationError {
  return new DomainValidationError(
    "INVALID_TIMEZONE",
    `The time zone '${timeZone}' is not a supported IANA time zone.`,
    "timezone",
  );
}

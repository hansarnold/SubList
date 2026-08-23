import {
  addCalendarDays,
  assertIsoCalendarDate,
  compareIsoCalendarDates,
  daysInMonth,
  differenceInCalendarDays,
  formatIsoCalendarDate,
  parseIsoCalendarDate,
  type IsoCalendarDate,
} from "./calendar-date";
import { DomainValidationError } from "./errors";

export const RECURRENCE_UNITS = ["day", "week", "month", "year"] as const;
export const ANCHOR_MODES = ["calendar_day", "end_of_month"] as const;

export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];
export type AnchorMode = (typeof ANCHOR_MODES)[number];
export type SubscriptionStatus = "active" | "cancelled";

export interface RecurrenceRule {
  readonly unit: RecurrenceUnit;
  readonly count: number;
  readonly anchorOn: IsoCalendarDate;
  readonly anchorMode: AnchorMode;
}

export interface ProjectionOptions {
  readonly maxOccurrences?: number;
}

const DEFAULT_MAX_OCCURRENCES = 10_000;

export function assertRecurrenceRule(rule: RecurrenceRule): RecurrenceRule {
  if (!RECURRENCE_UNITS.includes(rule.unit)) {
    throw invalidRecurrence("Unknown recurrence unit.", "recurrence.unit");
  }

  if (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 1_200) {
    throw invalidRecurrence(
      "Recurrence count must be an integer between 1 and 1200.",
      "recurrence.count",
    );
  }

  assertIsoCalendarDate(rule.anchorOn);

  if (!ANCHOR_MODES.includes(rule.anchorMode)) {
    throw invalidRecurrence("Unknown anchor mode.", "recurrence.anchorMode");
  }

  if (rule.anchorMode === "end_of_month" && rule.unit !== "month") {
    throw invalidRecurrence(
      "End-of-month mode is valid only for monthly recurrence.",
      "recurrence.anchorMode",
    );
  }

  return rule;
}

export function occurrenceAt(rule: RecurrenceRule, occurrenceIndex: number): IsoCalendarDate {
  assertRecurrenceRule(rule);
  assertOccurrenceIndex(occurrenceIndex);
  return occurrenceAtUnchecked(rule, occurrenceIndex);
}

export function occurrenceIndexOnOrAfter(rule: RecurrenceRule, targetOn: string): number {
  assertRecurrenceRule(rule);
  assertIsoCalendarDate(targetOn);

  let candidateIndex: number;

  switch (rule.unit) {
    case "day":
      candidateIndex = Math.ceil(differenceInCalendarDays(rule.anchorOn, targetOn) / rule.count);
      break;
    case "week":
      candidateIndex = Math.ceil(
        differenceInCalendarDays(rule.anchorOn, targetOn) / (rule.count * 7),
      );
      break;
    case "month": {
      const anchor = parseIsoCalendarDate(rule.anchorOn);
      const target = parseIsoCalendarDate(targetOn);
      const monthDifference = (target.year - anchor.year) * 12 + (target.month - anchor.month);
      candidateIndex = Math.floor(monthDifference / rule.count);
      break;
    }
    case "year": {
      const anchor = parseIsoCalendarDate(rule.anchorOn);
      const target = parseIsoCalendarDate(targetOn);
      candidateIndex = Math.floor((target.year - anchor.year) / rule.count);
      break;
    }
  }

  assertOccurrenceIndex(candidateIndex);
  let candidate: IsoCalendarDate;
  try {
    candidate = occurrenceAtUnchecked(rule, candidateIndex);
  } catch (error) {
    if (!(error instanceof DomainValidationError) || error.code !== "INVALID_DATE") {
      throw error;
    }
    candidateIndex += 1;
    assertOccurrenceIndex(candidateIndex);
    candidate = occurrenceAtUnchecked(rule, candidateIndex);
  }
  return compareIsoCalendarDates(candidate, targetOn) < 0 ? candidateIndex + 1 : candidateIndex;
}

export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, targetOn: string): IsoCalendarDate {
  const index = occurrenceIndexOnOrAfter(rule, targetOn);
  return occurrenceAtUnchecked(rule, index);
}

export function calculateNextBillingOn(
  rule: RecurrenceRule,
  localToday: string,
  status: SubscriptionStatus,
): IsoCalendarDate | null {
  if (status === "cancelled") {
    return null;
  }

  if (status !== "active") {
    throw invalidRecurrence("Unknown subscription status.", "status");
  }

  return nextOccurrenceOnOrAfter(rule, localToday);
}

export function projectOccurrences(
  rule: RecurrenceRule,
  windowStartOn: string,
  windowEndOn: string,
  options: ProjectionOptions = {},
): IsoCalendarDate[] {
  assertRecurrenceRule(rule);
  assertIsoCalendarDate(windowStartOn);
  assertIsoCalendarDate(windowEndOn);

  if (compareIsoCalendarDates(windowEndOn, windowStartOn) < 0) {
    throw new DomainValidationError(
      "INVALID_WINDOW",
      "The projection end date must not be before the start date.",
    );
  }

  const maximum = options.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES;
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new DomainValidationError(
      "INVALID_WINDOW",
      "The maximum occurrence count must be a positive integer.",
    );
  }

  let occurrenceIndex = occurrenceIndexOnOrAfter(rule, windowStartOn);
  let occurrence = occurrenceAtUnchecked(rule, occurrenceIndex);
  const projected: IsoCalendarDate[] = [];

  while (compareIsoCalendarDates(occurrence, windowEndOn) <= 0) {
    if (projected.length >= maximum) {
      throw new DomainValidationError(
        "TOO_MANY_OCCURRENCES",
        `The projection exceeds the ${maximum}-occurrence safety limit.`,
      );
    }

    projected.push(occurrence);
    if (compareIsoCalendarDates(occurrence, windowEndOn) === 0) {
      break;
    }

    occurrenceIndex += 1;
    assertOccurrenceIndex(occurrenceIndex);
    try {
      occurrence = occurrenceAtUnchecked(rule, occurrenceIndex);
    } catch (error) {
      if (error instanceof DomainValidationError && error.code === "INVALID_DATE") {
        break;
      }
      throw error;
    }
  }

  return projected;
}

function occurrenceAtUnchecked(rule: RecurrenceRule, occurrenceIndex: number): IsoCalendarDate {
  switch (rule.unit) {
    case "day":
      return addCalendarDays(rule.anchorOn, safeProduct(occurrenceIndex, rule.count));
    case "week":
      return addCalendarDays(rule.anchorOn, safeProduct(occurrenceIndex, rule.count, 7));
    case "month":
      return monthlyOccurrence(rule, occurrenceIndex);
    case "year":
      return yearlyOccurrence(rule, occurrenceIndex);
  }
}

function monthlyOccurrence(rule: RecurrenceRule, occurrenceIndex: number): IsoCalendarDate {
  const anchor = parseIsoCalendarDate(rule.anchorOn);
  const anchorMonthIndex = (anchor.year - 1) * 12 + (anchor.month - 1);
  const targetMonthIndex = anchorMonthIndex + safeProduct(occurrenceIndex, rule.count);
  const targetYear = Math.floor(targetMonthIndex / 12) + 1;
  const targetMonth = (targetMonthIndex % 12) + 1;

  if (targetYear < 1 || targetYear > 9_999) {
    throw new DomainValidationError(
      "INVALID_DATE",
      "The recurrence produces a date outside 0001 through 9999.",
    );
  }

  const finalDay = daysInMonth(targetYear, targetMonth);
  const targetDay = rule.anchorMode === "end_of_month" ? finalDay : Math.min(anchor.day, finalDay);

  return formatIsoCalendarDate({
    year: targetYear,
    month: targetMonth,
    day: targetDay,
  });
}

function yearlyOccurrence(rule: RecurrenceRule, occurrenceIndex: number): IsoCalendarDate {
  const anchor = parseIsoCalendarDate(rule.anchorOn);
  const targetYear = anchor.year + safeProduct(occurrenceIndex, rule.count);

  if (targetYear < 1 || targetYear > 9_999) {
    throw new DomainValidationError(
      "INVALID_DATE",
      "The recurrence produces a date outside 0001 through 9999.",
    );
  }

  return formatIsoCalendarDate({
    year: targetYear,
    month: anchor.month,
    day: Math.min(anchor.day, daysInMonth(targetYear, anchor.month)),
  });
}

function safeProduct(...factors: number[]): number {
  const product = factors.reduce((value, factor) => value * factor, 1);
  if (!Number.isSafeInteger(product)) {
    throw new DomainValidationError(
      "INVALID_RECURRENCE",
      "The recurrence interval exceeds the supported range.",
    );
  }

  return product;
}

function assertOccurrenceIndex(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw invalidRecurrence("Occurrence indexes must be safe integers.");
  }
}

function invalidRecurrence(message: string, path?: string): DomainValidationError {
  return new DomainValidationError("INVALID_RECURRENCE", message, path);
}

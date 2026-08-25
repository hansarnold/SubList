import { Temporal } from "temporal-polyfill";

import {
  addCalendarDays,
  assertIanaTimeZone,
  assertIsoCalendarDate,
  compareIsoCalendarDates,
  parseIsoCalendarDate,
  type IsoCalendarDate,
} from "./calendar-date";
import { DomainValidationError } from "./errors";
import { nextOccurrenceOnOrAfter, type RecurrenceRule } from "./recurrence";

export const REMINDER_LOCALES = ["en", "zh-Hans"] as const;
export const MAX_REMINDER_DAYS_BEFORE = 365;

export type ReminderLocale = (typeof REMINDER_LOCALES)[number];

export interface ReminderWindow {
  readonly planningOn: IsoCalendarDate;
  readonly intendedSendAt: number;
  readonly expiresAt: number;
}

export interface ReminderPlan {
  readonly planningOn: IsoCalendarDate;
  readonly billingOn: IsoCalendarDate;
  readonly effectiveDaysBefore: number;
}

const WHOLE_HOUR_LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):00$/;

export function assertReminderLocale(value: string): ReminderLocale {
  if (!REMINDER_LOCALES.includes(value as ReminderLocale)) {
    throw invalidReminder("The reminder locale must be 'en' or 'zh-Hans'.", "preferredLocale");
  }

  return value as ReminderLocale;
}

export function assertReminderDaysBefore(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_REMINDER_DAYS_BEFORE) {
    throw invalidReminder(
      `Reminder lead time must be an integer between 0 and ${MAX_REMINDER_DAYS_BEFORE}.`,
      "emailReminderDaysBefore",
    );
  }

  return value;
}

export function assertReminderLocalTime(value: string): string {
  if (!WHOLE_HOUR_LOCAL_TIME_PATTERN.test(value)) {
    throw invalidReminder(
      "Reminder local time must be a whole-hour value in HH:00 form.",
      "emailReminderLocalTime",
    );
  }

  return value;
}

export function effectiveReminderDaysBefore(
  accountDefault: number,
  subscriptionOverride: number | null,
): number {
  assertReminderDaysBefore(accountDefault);
  return subscriptionOverride === null
    ? accountDefault
    : assertReminderDaysBefore(subscriptionOverride);
}

export function resolveReminderWindow(input: {
  planningOn: string;
  localTime: string;
  timeZone: string;
}): ReminderWindow {
  const planningOn = assertIsoCalendarDate(input.planningOn);
  const { year, month, day } = parseIsoCalendarDate(planningOn);
  const hour = Number(assertReminderLocalTime(input.localTime).slice(0, 2));
  const timeZone = assertIanaTimeZone(input.timeZone);

  try {
    const intended = Temporal.ZonedDateTime.from(
      { timeZone, year, month, day, hour, minute: 0, second: 0, millisecond: 0 },
      { disambiguation: "compatible" },
    );
    const nextDate = parseIsoCalendarDate(addCalendarDays(planningOn, 1));
    const expires = Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: nextDate.year,
        month: nextDate.month,
        day: nextDate.day,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      { disambiguation: "compatible" },
    );

    return {
      planningOn,
      intendedSendAt: intended.epochMilliseconds,
      expiresAt: expires.epochMilliseconds,
    };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw error;
    }
    throw invalidReminder("The reminder window could not be resolved.");
  }
}

export function reminderPlanForBilling(
  rule: RecurrenceRule,
  billingOn: string,
  effectiveDaysBefore: number,
): ReminderPlan {
  const canonicalBillingOn = assertIsoCalendarDate(billingOn);
  const leadDays = assertReminderDaysBefore(effectiveDaysBefore);

  if (nextOccurrenceOnOrAfter(rule, canonicalBillingOn) !== canonicalBillingOn) {
    throw invalidReminder("The billing date is not an occurrence of the recurrence rule.");
  }

  return {
    planningOn: addCalendarDays(canonicalBillingOn, -leadDays),
    billingOn: canonicalBillingOn,
    effectiveDaysBefore: leadDays,
  };
}

export function nextReminderPlanOnOrAfter(
  rule: RecurrenceRule,
  effectiveDaysBefore: number,
  earliestPlanningOn: string,
): ReminderPlan {
  const planningOn = assertIsoCalendarDate(earliestPlanningOn);
  const leadDays = assertReminderDaysBefore(effectiveDaysBefore);
  const earliestBillingOn = addCalendarDays(planningOn, leadDays);
  const billingOn = nextOccurrenceOnOrAfter(rule, earliestBillingOn);
  const plan = reminderPlanForBilling(rule, billingOn, leadDays);

  if (compareIsoCalendarDates(plan.planningOn, planningOn) < 0) {
    throw invalidReminder("The calculated reminder plan precedes the requested window.");
  }

  return plan;
}

function invalidReminder(message: string, path?: string): DomainValidationError {
  return new DomainValidationError("INVALID_REMINDER", message, path);
}

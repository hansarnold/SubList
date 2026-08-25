import { addCalendarDays, localTodayInTimeZone } from "../../../domain/calendar-date";
import { nextOccurrenceOnOrAfter, type RecurrenceRule } from "../../../domain/recurrence";

export type ReminderDatePreview = {
  planningOn: string;
  billingOn: string;
};

export function buildReminderDatePreview(
  recurrence: RecurrenceRule,
  effectiveDaysBefore: number,
  timeZone: string,
  now = Date.now(),
): ReminderDatePreview {
  const localToday = localTodayInTimeZone(timeZone, now);
  const earliestBillingOn = addCalendarDays(localToday, effectiveDaysBefore);
  const billingOn = nextOccurrenceOnOrAfter(recurrence, earliestBillingOn);
  return {
    planningOn: addCalendarDays(billingOn, -effectiveDaysBefore),
    billingOn,
  };
}

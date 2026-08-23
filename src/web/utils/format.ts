import type { Recurrence, Subscription } from "../api/types";

const currencyFallbackSymbols: Record<string, string> = {
  CNY: "¥",
  JPY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function formatMoney(amount: string, currency: string, locale: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(value);
  } catch {
    return `${currencyFallbackSymbols[currency] ?? currency} ${amount}`;
  }
}

export function currencySymbol(currency: string, locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currencyFallbackSymbols[currency] ?? currency.slice(0, 1);
  }
}

export function parseDateOnly(date: string): Date {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function formatDate(
  date: string | null,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
) {
  if (!date) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(parseDateOnly(date));
}

export function formatTimestamp(timestamp: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function serviceMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

export function categoryFor(
  subscription: Subscription,
  categories: Array<{ id: string; name: string; color: string }>,
) {
  return categories.find((category) => category.id === subscription.categoryId) ?? null;
}

export function paymentMethodFor(
  subscription: Subscription,
  paymentMethods: Array<{ id: string; name: string; label: string | null }>,
) {
  return paymentMethods.find((payment) => payment.id === subscription.paymentMethodId) ?? null;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function dateOnly(year: number, monthIndex: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function occurrenceAt(recurrence: Recurrence, anchor: Date, index: number): string {
  const multiplier = recurrence.count * index;
  if (recurrence.unit === "day" || recurrence.unit === "week") {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() + multiplier * (recurrence.unit === "week" ? 7 : 1));
    return dateOnly(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  const months = recurrence.unit === "year" ? multiplier * 12 : multiplier;
  const absoluteMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
  const year = Math.floor(absoluteMonth / 12);
  const monthIndex = ((absoluteMonth % 12) + 12) % 12;
  const day =
    recurrence.anchorMode === "end_of_month" && recurrence.unit === "month"
      ? daysInMonth(year, monthIndex)
      : Math.min(anchor.getUTCDate(), daysInMonth(year, monthIndex));
  return dateOnly(year, monthIndex, day);
}

function localTodayDateOnly() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function approximateStartIndex(recurrence: Recurrence, anchor: Date, notBefore: Date) {
  if (notBefore <= anchor) return 0;
  if (recurrence.unit === "day" || recurrence.unit === "week") {
    const differenceInDays = Math.floor((notBefore.getTime() - anchor.getTime()) / 86_400_000);
    const intervalDays = recurrence.count * (recurrence.unit === "week" ? 7 : 1);
    return Math.max(0, Math.floor(differenceInDays / intervalDays));
  }

  const differenceInMonths =
    (notBefore.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    notBefore.getUTCMonth() -
    anchor.getUTCMonth();
  const intervalMonths = recurrence.count * (recurrence.unit === "year" ? 12 : 1);
  return Math.max(0, Math.floor(differenceInMonths / intervalMonths));
}

export function previewOccurrences(
  recurrence: Recurrence,
  count = 3,
  notBefore = localTodayDateOnly(),
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recurrence.anchorOn) || recurrence.count < 1) return [];
  const anchor = parseDateOnly(recurrence.anchorOn);
  const boundary = parseDateOnly(notBefore);
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(boundary.getTime()) || count < 1) return [];

  const results: string[] = [];
  let index = approximateStartIndex(recurrence, anchor, boundary);
  while (results.length < count) {
    const occurrence = occurrenceAt(recurrence, anchor, index);
    if (occurrence >= notBefore) results.push(occurrence);
    index += 1;
  }
  return results;
}

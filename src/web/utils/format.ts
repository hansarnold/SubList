import type { Category, PaymentMethod, Recurrence, Subscription } from "../api/types";
import { occurrenceAt, occurrenceIndexOnOrAfter } from "../../domain/recurrence";

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

export function categoryFor(subscription: Subscription, categories: Category[]) {
  return categories.find((category) => category.id === subscription.categoryId) ?? null;
}

export function paymentMethodFor(subscription: Subscription, paymentMethods: PaymentMethod[]) {
  return paymentMethods.find((payment) => payment.id === subscription.paymentMethodId) ?? null;
}

function localTodayDateOnly() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function previewOccurrences(
  recurrence: Recurrence,
  count = 3,
  notBefore = localTodayDateOnly(),
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recurrence.anchorOn) || recurrence.count < 1) return [];
  if (count < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(notBefore)) return [];
  try {
    const firstIndex = occurrenceIndexOnOrAfter(recurrence, notBefore);
    return Array.from({ length: count }, (_, offset) =>
      occurrenceAt(recurrence, firstIndex + offset),
    );
  } catch {
    return [];
  }
}

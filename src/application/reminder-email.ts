import {
  assertCurrencyCode,
  assertPersistedMicros,
  assertReminderDaysBefore,
  assertReminderLocale,
  formatMicrosAsAmount,
  parseIsoCalendarDate,
  type RecurrenceUnit,
  type ReminderLocale,
} from "../domain";

export const RENEWAL_EMAIL_TEMPLATE_VERSION = 1;

export type ReminderEmailInput = {
  locale: ReminderLocale;
  subscriptionId: string;
  subscriptionName: string;
  amountMicros: number;
  currency: string;
  billingOn: string;
  effectiveDaysBefore: number;
  recurrence: {
    unit: RecurrenceUnit;
    count: number;
  };
  appBaseUrl: string;
};

export type RenderedReminderEmail = {
  subject: string;
  text: string;
  html: string;
};

export function renderRenewalReminderEmail(input: ReminderEmailInput): RenderedReminderEmail {
  const locale = assertReminderLocale(input.locale);
  const amount = `${assertCurrencyCode(input.currency)} ${formatMicrosAsAmount(
    assertPersistedMicros(input.amountMicros),
  )}`;
  const daysBefore = assertReminderDaysBefore(input.effectiveDaysBefore);
  const billingDate = formatBillingDate(input.billingOn, locale);
  const recurrence = formatRecurrence(input.recurrence, locale);
  const appUrl = new URL(
    `/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
    assertHttpBaseUrl(input.appBaseUrl),
  ).toString();

  const copy =
    locale === "zh-Hans"
      ? {
          subject: `${sanitizeSubjectFragment(input.subscriptionName)} 预计续费提醒`,
          intro: `${input.subscriptionName} 预计将在 ${billingDate} 续费（${formatLead(daysBefore, locale)}）。`,
          amount: `预计金额：${amount}`,
          recurrence: `周期：${recurrence}`,
          action: `查看订阅：${appUrl}`,
          disclaimer: "这是账本中的预计提醒，不代表实际扣款、账单或支付确认。",
          link: "查看订阅",
        }
      : {
          subject: `Estimated renewal for ${sanitizeSubjectFragment(input.subscriptionName)}`,
          intro: `${input.subscriptionName} is estimated to renew on ${billingDate} (${formatLead(daysBefore, locale)}).`,
          amount: `Estimated amount: ${amount}`,
          recurrence: `Recurrence: ${recurrence}`,
          action: `View subscription: ${appUrl}`,
          disclaimer:
            "This is an estimate from your tracker, not a charge, invoice, or payment confirmation.",
          link: "View subscription",
        };

  const text = [copy.intro, copy.amount, copy.recurrence, copy.action, "", copy.disclaimer].join(
    "\n",
  );
  const html = [
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p>${escapeHtml(copy.amount)}<br>${escapeHtml(copy.recurrence)}</p>`,
    `<p><a href="${escapeHtml(appUrl)}">${escapeHtml(copy.link)}</a></p>`,
    `<p><small>${escapeHtml(copy.disclaimer)}</small></p>`,
  ].join("");

  return { subject: copy.subject, text, html };
}

function formatBillingDate(value: string, locale: ReminderLocale): string {
  const { year, month, day } = parseIsoCalendarDate(value);
  return new Intl.DateTimeFormat(locale === "zh-Hans" ? "zh-CN" : "en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatLead(days: number, locale: ReminderLocale): string {
  if (locale === "zh-Hans") {
    return days === 0 ? "今天" : `${days} 天后`;
  }
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

function formatRecurrence(
  recurrence: ReminderEmailInput["recurrence"],
  locale: ReminderLocale,
): string {
  const { unit, count } = recurrence;
  if (!Number.isInteger(count) || count < 1 || count > 1_200) {
    throw new RangeError("Recurrence count is outside the supported range.");
  }

  if (locale === "zh-Hans") {
    const label = { day: "天", week: "周", month: "个月", year: "年" }[unit];
    return count === 1 ? `每${label}` : `每 ${count} ${label}`;
  }

  const label = count === 1 ? unit : `${unit}s`;
  return count === 1 ? `every ${label}` : `every ${count} ${label}`;
}

function assertHttpBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new TypeError("The application base URL must use HTTP or HTTPS.");
  }
  return url;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function sanitizeSubjectFragment(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

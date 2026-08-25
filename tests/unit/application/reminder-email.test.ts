import { describe, expect, it } from "vitest";

import { renderRenewalReminderEmail } from "../../../src/application/reminder-email";

const baseInput = {
  locale: "en" as const,
  subscriptionId: "sub/unsafe",
  subscriptionName: "Cloud <Pro>",
  amountMicros: 20_123_456,
  currency: "USD",
  billingOn: "2026-09-01",
  effectiveDaysBefore: 7,
  recurrence: { unit: "month" as const, count: 1 },
  appBaseUrl: "https://sublist.example.test",
};

describe("renewal email localization", () => {
  it("renders an exact original-currency estimate without unsafe HTML", () => {
    const rendered = renderRenewalReminderEmail(baseInput);

    expect(rendered.subject).toBe("Estimated renewal for Cloud <Pro>");
    expect(rendered.text).toContain("USD 20.123456");
    expect(rendered.text).toContain("not a charge, invoice, or payment confirmation");
    expect(rendered.text).toContain("/subscriptions/sub%2Funsafe");
    expect(rendered.html).toContain("Cloud &lt;Pro&gt;");
    expect(rendered.html).not.toContain("Cloud <Pro>");
  });

  it("renders Simplified Chinese copy from the persisted locale", () => {
    const rendered = renderRenewalReminderEmail({
      ...baseInput,
      locale: "zh-Hans",
      effectiveDaysBefore: 1,
      recurrence: { unit: "year", count: 2 },
    });

    expect(rendered.subject).toContain("预计续费提醒");
    expect(rendered.text).toContain("1 天后");
    expect(rendered.text).toContain("每 2 年");
    expect(rendered.text).toContain("不代表实际扣款");
  });

  it("removes control characters from the subject", () => {
    const rendered = renderRenewalReminderEmail({
      ...baseInput,
      subscriptionName: "Safe\r\nBcc: attacker@example.test",
    });
    expect(rendered.subject).toBe("Estimated renewal for Safe Bcc: attacker@example.test");
    expect(rendered.subject).not.toMatch(/[\r\n]/);
  });
});

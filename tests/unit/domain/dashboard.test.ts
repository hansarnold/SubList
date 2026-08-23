import { describe, expect, it } from "vitest";

import {
  buildDashboardStatistics,
  formatMicrosAsAmount,
  formatRationalMicrosAsAmount,
  type DashboardSubscription,
  type RecurrenceRule,
} from "../../../src/domain";

const productivity = {
  id: "category-productivity",
  name: "Productivity",
  color: "#36B894",
  symbol: null,
};
const utilities = {
  id: "category-utilities",
  name: "Utilities",
  color: "#4D8DFF",
  symbol: null,
};
const visa = { id: "payment-visa", name: "Visa", kind: "card" as const, symbol: null };

function subscription(
  overrides: Partial<DashboardSubscription> &
    Pick<DashboardSubscription, "id" | "name" | "amountMicros" | "currency">,
): DashboardSubscription {
  const recurrence: RecurrenceRule = {
    unit: "month",
    count: 1,
    anchorOn: "2026-08-30",
    anchorMode: "calendar_day",
  };

  return {
    symbol: null,
    recurrence,
    status: "active",
    archivedAt: null,
    category: null,
    paymentMethod: null,
    ...overrides,
  };
}

describe("dashboard statistics", () => {
  it("rejects an upcoming window beyond the personal-MVP bound", () => {
    expect(() => buildDashboardStatistics([], "2026-08-23", 31)).toThrowError(
      expect.objectContaining({ code: "INVALID_WINDOW", path: "upcomingDays" }),
    );
  });

  it("expands actual charges and keeps every currency separate", () => {
    const statistics = buildDashboardStatistics(
      [
        subscription({
          id: "daily-usd",
          name: "Daily USD",
          amountMicros: 1_000_000,
          currency: "USD",
          recurrence: {
            unit: "day",
            count: 1,
            anchorOn: "2026-08-20",
            anchorMode: "calendar_day",
          },
          category: productivity,
          paymentMethod: visa,
        }),
        subscription({
          id: "monthly-usd",
          name: "Monthly USD",
          amountMicros: 10_000_000,
          currency: "USD",
          category: productivity,
          paymentMethod: visa,
        }),
        subscription({
          id: "monthly-cny",
          name: "Monthly CNY",
          amountMicros: 20_000_000,
          currency: "CNY",
          recurrence: {
            unit: "month",
            count: 1,
            anchorOn: "2026-08-24",
            anchorMode: "calendar_day",
          },
          category: utilities,
        }),
      ],
      "2026-08-23",
      3,
    );

    expect(statistics.upcomingThrough).toBe("2026-08-25");
    expect(statistics.upcoming.map((charge) => charge.subscriptionId)).toEqual([
      "daily-usd",
      "daily-usd",
      "monthly-cny",
      "daily-usd",
    ]);
    expect(statistics.nextCharge?.subscriptionId).toBe("daily-usd");

    expect(statistics.totalsByCurrency.map((total) => total.currency)).toEqual(["CNY", "USD"]);
    const cny = statistics.totalsByCurrency[0];
    const usd = statistics.totalsByCurrency[1];
    expect(formatMicrosAsAmount(cny?.upcomingAmountMicros ?? 0n)).toBe("20");
    expect(formatMicrosAsAmount(usd?.upcomingAmountMicros ?? 0n)).toBe("3");
    expect(formatMicrosAsAmount(cny?.currentMonthAmountMicros ?? 0n)).toBe("20");
    expect(formatMicrosAsAmount(cny?.currentYearAmountMicros ?? 0n)).toBe("240");
    expect(formatMicrosAsAmount(usd?.currentMonthAmountMicros ?? 0n)).toBe("41");
    expect(formatMicrosAsAmount(usd?.currentYearAmountMicros ?? 0n)).toBe("485");
    expect(
      formatRationalMicrosAsAmount(
        cny?.monthlyEstimateMicros ?? { numerator: 0n, denominator: 1n },
      ),
    ).toBe("20");
    expect(
      formatRationalMicrosAsAmount(
        usd?.monthlyEstimateMicros ?? { numerator: 0n, denominator: 1n },
      ),
    ).toBe("40.436875");
  });

  it("aggregates category and payment-method estimates without mixing currencies", () => {
    const statistics = buildDashboardStatistics(
      [
        subscription({
          id: "usd",
          name: "USD subscription",
          amountMicros: 10_000_000,
          currency: "USD",
          category: productivity,
          paymentMethod: visa,
        }),
        subscription({
          id: "cny",
          name: "CNY subscription",
          amountMicros: 80_000_000,
          currency: "CNY",
          category: productivity,
          paymentMethod: visa,
        }),
        subscription({
          id: "uncategorized",
          name: "Uncategorized",
          amountMicros: 5_000_000,
          currency: "USD",
        }),
      ],
      "2026-08-23",
      7,
    );

    const category = statistics.categoryBreakdown.find((item) => item.id === productivity.id);
    expect(category?.subscriptionCount).toBe(2);
    expect(category?.totalsByCurrency.map((total) => total.currency)).toEqual(["CNY", "USD"]);
    expect(statistics.categoryBreakdown.find((item) => item.id === null)?.subscriptionCount).toBe(
      1,
    );

    const payment = statistics.paymentMethodBreakdown.find((item) => item.id === visa.id);
    expect(payment?.subscriptionCount).toBe(2);
    expect(payment?.paymentMethodKind).toBe("card");
    expect(payment?.totalsByCurrency).toHaveLength(2);
  });

  it("excludes cancelled and archived subscriptions from every summary", () => {
    const statistics = buildDashboardStatistics(
      [
        subscription({
          id: "active",
          name: "Active",
          amountMicros: 1_000_000,
          currency: "USD",
          category: utilities,
        }),
        subscription({
          id: "cancelled",
          name: "Cancelled",
          amountMicros: 100_000_000,
          currency: "USD",
          status: "cancelled",
          category: productivity,
        }),
        subscription({
          id: "archived",
          name: "Archived",
          amountMicros: 100_000_000,
          currency: "USD",
          archivedAt: 1_786_000_000_000,
          category: productivity,
        }),
      ],
      "2026-08-23",
      30,
    );

    expect(statistics.categoryBreakdown).toHaveLength(1);
    expect(statistics.categoryBreakdown[0]?.id).toBe(utilities.id);
    expect(statistics.totalsByCurrency).toHaveLength(1);
  });

  it("calculates next charge independently from the selected upcoming window", () => {
    const statistics = buildDashboardStatistics(
      [
        subscription({
          id: "future",
          name: "Future charge",
          amountMicros: 9_990_000,
          currency: "USD",
          recurrence: {
            unit: "month",
            count: 1,
            anchorOn: "2026-09-30",
            anchorMode: "calendar_day",
          },
        }),
      ],
      "2026-08-23",
      7,
    );

    expect(statistics.upcoming).toEqual([]);
    expect(statistics.nextCharge?.billingOn).toBe("2026-08-30");
  });

  it("retains exact estimates until after aggregation", () => {
    const statistics = buildDashboardStatistics(
      [
        subscription({
          id: "half-one",
          name: "Half one",
          amountMicros: 1,
          currency: "USD",
          recurrence: {
            unit: "year",
            count: 2,
            anchorOn: "2026-01-01",
            anchorMode: "calendar_day",
          },
        }),
        subscription({
          id: "half-two",
          name: "Half two",
          amountMicros: 1,
          currency: "USD",
          recurrence: {
            unit: "year",
            count: 2,
            anchorOn: "2026-01-01",
            anchorMode: "calendar_day",
          },
        }),
      ],
      "2026-08-23",
      7,
    );

    expect(
      formatRationalMicrosAsAmount(
        statistics.totalsByCurrency[0]?.annualizedEstimateMicros ?? {
          numerator: 0n,
          denominator: 1n,
        },
      ),
    ).toBe("0.000001");
  });

  it("replays a future known annual occurrence across the complete current year", () => {
    const statistics = buildDashboardStatistics(
      [
        subscription({
          id: "annual",
          name: "Annual subscription",
          amountMicros: 98_000_000,
          currency: "CNY",
          recurrence: {
            unit: "year",
            count: 1,
            anchorOn: "2027-08-19",
            anchorMode: "calendar_day",
          },
        }),
      ],
      "2026-08-23",
      7,
    );

    expect(
      formatMicrosAsAmount(statistics.totalsByCurrency[0]?.currentMonthAmountMicros ?? 0n),
    ).toBe("98");
    expect(
      formatMicrosAsAmount(statistics.totalsByCurrency[0]?.currentYearAmountMicros ?? 0n),
    ).toBe("98");
  });
});

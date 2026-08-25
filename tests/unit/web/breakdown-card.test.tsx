// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FxStatus } from "../../../src/shared/api-types";
import { BreakdownCard, BreakdownTooltip } from "../../../src/web/features/dashboard/BreakdownCard";
import i18n from "../../../src/web/i18n";

const noFx: FxStatus = {
  state: "not_needed",
  provider: null,
  rateDate: null,
  fetchedAt: null,
  missingCurrencies: [],
};

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

afterEach(() => cleanup());

describe("Dashboard breakdown card", () => {
  it("switches between amount-based bar and donut views and remembers the choice", async () => {
    render(
      <BreakdownCard
        title="Category breakdown"
        storageKey="test-breakdown"
        currency="USD"
        fx={noFx}
        locale="en"
        items={[
          {
            key: "productivity",
            label: "Productivity",
            color: "#2563EB",
            subscriptionCount: 2,
            reportingMonthlyAverage: "20",
            totalsByCurrency: [{ currency: "USD", monthlyEstimate: "20" }],
          },
          {
            key: "entertainment",
            label: "Entertainment",
            color: "#7C3AED",
            subscriptionCount: 8,
            reportingMonthlyAverage: "10",
            totalsByCurrency: [{ currency: "USD", monthlyEstimate: "10" }],
          },
        ]}
        renderSymbol={() => null}
      />,
    );

    const bars = screen.getByRole("button", { name: "Bars" });
    const donut = screen.getByRole("button", { name: "Donut" });
    expect(bars.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(donut);
    expect(donut.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(localStorage.getItem("test-breakdown")).toBe("donut"));
    expect(screen.getByRole("group", { name: /Category breakdown.*Donut/ })).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Category breakdown.*Donut/ })).toBeNull();
  });

  it("uses a 100% value state and retains the complete original-currency list", () => {
    render(
      <BreakdownCard
        title="Category breakdown"
        storageKey="test-breakdown"
        currency="USD"
        fx={noFx}
        locale="en"
        items={[
          {
            key: "productivity",
            label: "Productivity",
            color: "#2563EB",
            subscriptionCount: 2,
            reportingMonthlyAverage: "20",
            totalsByCurrency: [
              { currency: "CNY", monthlyEstimate: "72" },
              { currency: "USD", monthlyEstimate: "10" },
            ],
          },
        ]}
        renderSymbol={() => <span aria-hidden="true">P</span>}
      />,
    );

    expect(screen.getByText("100% of this estimate")).toBeTruthy();
    const original = screen.getByRole("list", { name: "Original-currency monthly estimates" });
    expect(within(original).getByText("CNY")).toBeTruthy();
    expect(within(original).getByText("USD")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Donut" })).toBeNull();
  });

  it("does not substitute counts when conversion is unavailable", () => {
    render(
      <BreakdownCard
        title="Payment method breakdown"
        storageKey="test-payment-breakdown"
        currency="CNY"
        fx={{ ...noFx, state: "unavailable", missingCurrencies: ["USD"] }}
        locale="en"
        items={[
          {
            key: "card",
            label: "Card",
            color: null,
            subscriptionCount: 4,
            reportingMonthlyAverage: null,
            totalsByCurrency: [{ currency: "USD", monthlyEstimate: "40" }],
          },
        ]}
        renderSymbol={() => null}
      />,
    );

    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
    expect(screen.getByText("$40.00")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Payment method breakdown.*Bars/ })).toBeNull();
  });

  it("announces keyboard tooltip changes politely and atomically", () => {
    render(
      <BreakdownTooltip
        active
        accessibilityLayer
        currency="USD"
        locale="en"
        payload={[
          {
            payload: {
              key: "productivity",
              label: "Productivity",
              color: "#2563EB",
              subscriptionCount: 2,
              reportingMonthlyAverage: "20",
              totalsByCurrency: [{ currency: "USD", monthlyEstimate: "20" }],
              amountMicros: 20_000_000n,
              chartValue: 20,
              chartColor: "#2563EB",
              share: 66.7,
            },
          },
        ]}
      />,
    );

    const tooltip = screen.getByRole("status");
    expect(tooltip.getAttribute("aria-live")).toBe("polite");
    expect(tooltip.getAttribute("aria-atomic")).toBe("true");
    expect(tooltip.textContent).toContain("Productivity");
    expect(tooltip.textContent).toContain("$20.00");
  });
});

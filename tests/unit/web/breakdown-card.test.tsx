// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BreakdownCard, BreakdownTooltip } from "../../../src/web/features/dashboard/BreakdownCard";
import i18n from "../../../src/web/i18n";

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

afterEach(() => cleanup());

describe("Dashboard breakdown card", () => {
  it("shows separate amount and share charts with one authoritative table", () => {
    localStorage.setItem("legacy-breakdown-view", "donut");
    render(
      <BreakdownCard
        title="Category breakdown"
        barTitle="Category amounts"
        pieTitle="Category share"
        currency="USD"
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

    expect(
      screen.getByRole("group", {
        name: "Category amounts, bar chart of estimated monthly averages in USD",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", {
        name: "Category share, pie chart of estimated monthly-average share in USD",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bar|pie|donut/i })).toBeNull();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("legacy-breakdown-view")).toBe("donut");

    const table = screen.getByRole("table", {
      name: "Complete estimated monthly-average values for Category breakdown in USD",
    });
    expect(within(table).getByRole("columnheader", { name: "Group" })).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "Productivity" })).toBeTruthy();
    expect(within(table).getByText("66.7%")).toBeTruthy();
  });

  it("renders both charts and a 100% pie for one positive group", () => {
    render(
      <BreakdownCard
        title="Category breakdown"
        barTitle="Category amounts"
        pieTitle="Category share"
        currency="USD"
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

    expect(screen.getByRole("group", { name: /Category amounts, bar chart/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /Category share, pie chart/ })).toBeTruthy();
    const table = screen.getByRole("table", { name: /Category breakdown/ });
    expect(within(table).getByText("100%")).toBeTruthy();
    const original = within(table).getByRole("list", {
      name: "Original-currency monthly estimates for Productivity",
    });
    expect(within(original).getByText("CNY")).toBeTruthy();
    expect(within(original).getByText("USD")).toBeTruthy();
  });

  it("uses one section-level incomplete-conversion state and preserves the table", () => {
    render(
      <BreakdownCard
        title="Payment method breakdown"
        barTitle="Payment method amounts"
        pieTitle="Payment method share"
        currency="CNY"
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

    expect(screen.getByText(/Amount charts are unavailable/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: /bar chart|pie chart/ })).toBeNull();
    const table = screen.getByRole("table", { name: /Payment method breakdown/ });
    expect(within(table).getAllByText("Unavailable")).toHaveLength(2);
    expect(within(table).getByText("$40.00")).toBeTruthy();
  });

  it("uses one compact section state when there is no breakdown data", () => {
    render(
      <BreakdownCard
        title="Category breakdown"
        barTitle="Category amounts"
        pieTitle="Category share"
        currency="USD"
        locale="en"
        items={[]}
        renderSymbol={() => null}
      />,
    );

    expect(screen.getByText("Add an active subscription to see this breakdown.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /bar chart|pie chart/ })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
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

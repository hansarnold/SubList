// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Category, Dashboard, Session, Subscription } from "../../../src/web/api/types";
import { api } from "../../../src/web/api/client";
import { sessionQueryKey } from "../../../src/web/api/query-keys";
import { CategoriesPage } from "../../../src/web/features/categories/CategoriesPage";
import i18n from "../../../src/web/i18n";

const categories: Category[] = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    name: "Productivity",
    color: "#2563eb",
    symbol: { type: "icon", value: "briefcase" },
    position: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    name: "Empty saved category",
    color: "#9333ea",
    symbol: null,
    position: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

function subscription(
  id: string,
  name: string,
  categoryId: string | null,
  nextBillingOn: string,
): Subscription {
  return {
    id,
    name,
    symbol: null,
    amount: "12.50",
    currency: "USD",
    recurrence: { unit: "month", count: 1, anchorOn: nextBillingOn, anchorMode: "calendar_day" },
    nextBillingOn,
    status: "active",
    cancelledAt: null,
    archivedAt: null,
    categoryId,
    paymentMethodId: null,
    websiteUrl: null,
    notes: null,
    emailReminderEnabled: false,
    emailReminderDaysBefore: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const subscriptions = [
  subscription("00000000-0000-4000-8000-000000000101", "Alpha", categories[0]!.id, "2026-09-01"),
  subscription("00000000-0000-4000-8000-000000000102", "Beta", categories[0]!.id, "2026-09-02"),
  subscription("00000000-0000-4000-8000-000000000103", "Gamma", categories[0]!.id, "2026-09-03"),
  subscription("00000000-0000-4000-8000-000000000104", "Delta", categories[0]!.id, "2026-09-04"),
  subscription("00000000-0000-4000-8000-000000000105", "Loose", null, "2026-09-05"),
];

const dashboard: Dashboard = {
  localToday: "2026-08-25",
  upcomingThrough: "2026-09-24",
  nextCharge: null,
  reporting: {
    currency: "USD",
    monthlyAverage: { amount: "62.50", currency: "USD" },
    annualized: { amount: "750.00", currency: "USD" },
    currentMonthCharges: null,
    currentYearCharges: null,
    fx: {
      state: "not_needed",
      provider: null,
      rateDate: null,
      fetchedAt: null,
      missingCurrencies: [],
    },
  },
  totalsByCurrency: [],
  upcoming: [],
  categoryBreakdown: [
    {
      categoryId: categories[0]!.id,
      categoryName: categories[0]!.name,
      categoryColor: categories[0]!.color,
      categorySymbol: categories[0]!.symbol,
      subscriptionCount: 4,
      totalsByCurrency: [],
      reportingMonthlyAverage: "50.00",
      reportingAnnualized: "600.00",
    },
    {
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      categorySymbol: null,
      subscriptionCount: 1,
      totalsByCurrency: [],
      reportingMonthlyAverage: "12.50",
      reportingAnnualized: "150.00",
    },
  ],
  paymentMethodBreakdown: [],
};

const session = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner@example.test",
    displayName: null,
    timezone: "UTC",
    reportingCurrency: "USD",
    onboardingCompletedAt: "2026-08-01T00:00:00.000Z",
    interfaceLocale: "en",
    emailLocale: "en",
    defaultEmailReminderDaysBefore: 7,
    emailReminderLocalTime: "09:00",
    emailRemindersPaused: false,
    emailReminderSystemSuspended: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  environment: "local",
  capabilities: { emailReminders: false },
} satisfies Session;

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryKey, session);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Categories page", () => {
  it("joins three fixed requests into nonempty category cards and keeps Uncategorized last", async () => {
    const categoriesRequest = vi.spyOn(api, "categories").mockResolvedValue(categories);
    const dashboardRequest = vi.spyOn(api, "dashboard").mockResolvedValue(dashboard);
    const subscriptionsRequest = vi.spyOn(api, "subscriptions").mockResolvedValue(subscriptions);

    renderPage();

    const grid = await screen.findByRole("region", { name: "Categories" });
    const cards = within(grid).getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("heading", { name: "Productivity" })).toBeTruthy();
    expect(within(cards[1]!).getByRole("heading", { name: "Uncategorized" })).toBeTruthy();
    expect(screen.queryByText("Empty saved category")).toBeNull();

    expect(within(cards[0]!).getByText("$50.00")).toBeTruthy();
    expect(within(cards[0]!).getByText("$600.00")).toBeTruthy();
    expect(within(cards[0]!).getAllByText("Alpha")).toHaveLength(2);
    expect(within(cards[0]!).queryByText("Delta")).toBeNull();
    expect(within(cards[0]!).getByRole("link", { name: "View all 4" }).getAttribute("href")).toBe(
      `/subscriptions?categoryId=${categories[0]!.id}&status=active`,
    );
    expect(
      within(cards[1]!).getByRole("link", { name: "Uncategorized" }).getAttribute("href"),
    ).toBe("/subscriptions?categoryId=none&status=active");

    await waitFor(() => {
      expect(categoriesRequest).toHaveBeenCalledOnce();
      expect(dashboardRequest).toHaveBeenCalledOnce();
      expect(subscriptionsRequest).toHaveBeenCalledOnce();
    });
    expect(subscriptionsRequest.mock.calls[0]?.[0]?.get("status")).toBe("active");
    expect(subscriptionsRequest.mock.calls[0]?.[0]?.get("archived")).toBe("exclude");
  });
});

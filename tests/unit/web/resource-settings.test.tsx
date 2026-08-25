// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, PaymentMethod, Session } from "../../../src/web/api/types";
import { api } from "../../../src/web/api/client";
import { sessionQueryKey } from "../../../src/web/api/query-keys";
import {
  CategorySettingsPage,
  PaymentMethodSettingsPage,
} from "../../../src/web/features/settings/SettingsPages";
import i18n from "../../../src/web/i18n";

const category: Category = {
  id: "00000000-0000-4000-8000-000000000011",
  name: "Productivity",
  color: "#2563eb",
  symbol: { type: "icon", value: "briefcase" },
  position: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const paymentMethod: PaymentMethod = {
  id: "00000000-0000-4000-8000-000000000021",
  name: "Manual invoice",
  kind: "other",
  label: null,
  symbol: { type: "icon", value: "invoice" },
  position: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
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
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(callback, 0),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(page: "categories" | "payment-methods" = "categories") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(sessionQueryKey, session);
  render(
    <QueryClientProvider client={client}>
      {page === "categories" ? <CategorySettingsPage /> : <PaymentMethodSettingsPage />}
    </QueryClientProvider>,
  );
}

describe("resource Settings", () => {
  it("keeps common categories visible beside the compact saved list", async () => {
    vi.spyOn(api, "categories").mockResolvedValue([category]);
    renderPage();

    expect(await screen.findByText("Productivity")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Common categories" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entertainment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Productivity" })).toBeNull();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Entertainment" }));
    const dialog = screen.getByRole("dialog", { name: "Add category" });
    expect(within(dialog).getByDisplayValue("Entertainment")).toBeTruthy();
    expect(within(dialog).queryByText(/preset|ready to add/i)).toBeNull();
  });

  it("keeps common payment methods visible and opens a reviewed draft", async () => {
    vi.spyOn(api, "paymentMethods").mockResolvedValue([paymentMethod]);
    renderPage("payment-methods");

    expect(await screen.findByText("Manual invoice")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Common payment methods" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Visa" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manual invoice" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Visa" }));
    const dialog = screen.getByRole("dialog", { name: "Add payment method" });
    expect(within(dialog).getByDisplayValue("Visa")).toBeTruthy();
    expect(within(dialog).getByDisplayValue("Card")).toBeTruthy();
    expect(within(dialog).queryByText(/preset|ready to add/i)).toBeNull();
  });

  it("closes on Escape and returns focus to the Add category trigger", async () => {
    vi.spyOn(api, "categories").mockResolvedValue([]);
    renderPage();

    const addButton = await screen.findByRole("button", { name: "Add category" });
    addButton.focus();
    fireEvent.click(addButton);
    const dialog = screen.getByRole("dialog", { name: "Add category" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(addButton));
  });
});

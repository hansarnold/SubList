// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentMethod, Session, User } from "../../../src/web/api/types";
import { api } from "../../../src/web/api/client";
import { sessionQueryKey } from "../../../src/web/api/query-keys";
import { PaymentMethodSettingsPage } from "../../../src/web/features/settings/SettingsPages";
import i18n from "../../../src/web/i18n";

const user: User = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  displayName: "Owner",
  timezone: "Asia/Shanghai",
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
};

const session: Session = {
  user,
  environment: "local",
  capabilities: { emailReminders: true },
};

const paymentMethod: PaymentMethod = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Work Visa",
  kind: "card",
  label: "•••• 4242",
  symbol: { type: "icon", value: "brand_visa" },
  position: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

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

describe("settings resource cache invalidation", () => {
  it("invalidates list, detail, and dashboard data after deleting a payment method", async () => {
    vi.spyOn(api, "paymentMethods").mockResolvedValue([paymentMethod]);
    const remove = vi.spyOn(api, "deletePaymentMethod").mockResolvedValue(undefined);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData(sessionQueryKey, session);
    client.setQueryData(["subscriptions"], [{ marker: "stale-list" }]);
    client.setQueryData(["subscription", "subscription-1"], { marker: "stale-detail" });
    client.setQueryData(["dashboard"], { marker: "stale-dashboard" });

    render(
      <QueryClientProvider client={client}>
        <PaymentMethodSettingsPage />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete Work Visa" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(remove.mock.calls[0]?.[0]).toBe(paymentMethod.id));
    await waitFor(() => {
      expect(client.getQueryState(["subscriptions"])?.isInvalidated).toBe(true);
      expect(client.getQueryState(["subscription", "subscription-1"])?.isInvalidated).toBe(true);
      expect(client.getQueryState(["dashboard"])?.isInvalidated).toBe(true);
    });
  });
});

// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Session, Subscription, SubscriptionDetail, User } from "../../../src/web/api/types";
import { ApiError, api } from "../../../src/web/api/client";
import { ProfileSettingsPage } from "../../../src/web/features/settings/SettingsPages";
import { SubscriptionDetailPage } from "../../../src/web/features/subscriptions/SubscriptionDetailPage";
import { SubscriptionFormPage } from "../../../src/web/features/subscriptions/SubscriptionFormPage";
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

const subscription: Subscription = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Manual enterprise renewal",
  symbol: null,
  amount: "9999.00",
  currency: "USD",
  recurrence: {
    unit: "month",
    count: 1,
    anchorOn: "2026-09-15",
    anchorMode: "calendar_day",
  },
  nextBillingOn: "2026-09-15",
  status: "active",
  cancelledAt: null,
  archivedAt: null,
  categoryId: null,
  paymentMethodId: null,
  websiteUrl: null,
  notes: null,
  emailReminderEnabled: false,
  emailReminderDaysBefore: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function session(account: User, emailReminders: boolean): Session {
  return {
    user: account,
    environment: "local",
    capabilities: { emailReminders },
  };
}

function queryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderRoute(element: React.ReactNode, initialEntry: string, path: string) {
  const client = queryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<div>Navigation complete</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function mockSubscriptionPage({
  account = user,
  emailReminders = true,
  record,
}: {
  account?: User;
  emailReminders?: boolean;
  record?: SubscriptionDetail;
} = {}) {
  vi.spyOn(api, "session").mockResolvedValue(session(account, emailReminders));
  vi.spyOn(api, "me").mockResolvedValue(account);
  vi.spyOn(api, "categories").mockResolvedValue([]);
  vi.spyOn(api, "paymentMethods").mockResolvedValue([]);
  if (record) vi.spyOn(api, "subscription").mockResolvedValue(record);
}

function detail(
  state: SubscriptionDetail["emailReminderDelivery"]["state"],
  overrides: Partial<SubscriptionDetail> = {},
): SubscriptionDetail {
  return {
    ...subscription,
    emailReminderEnabled: true,
    emailReminderDaysBefore: null,
    emailReminderDelivery: {
      state,
      occurrenceOn: "2026-09-15",
      lastAttemptAt: state === "scheduled" ? null : "2026-08-24T01:00:00.000Z",
    },
    ...overrides,
  };
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(callback, 0),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("subscription renewal-email preference", () => {
  it("keeps a new high-value manual renewal opted out until its own switch is selected", async () => {
    mockSubscriptionPage();
    const create = vi.spyOn(api, "createSubscription").mockResolvedValue(subscription);
    renderRoute(<SubscriptionFormPage />, "/subscriptions/new", "/subscriptions/new");

    const reminder = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: /Email me before this estimated renewal/,
    });
    expect(reminder.checked).toBe(false);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Manual enterprise renewal" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "9999.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add subscription" }));

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Manual enterprise renewal",
        amount: "9999.00",
        emailReminderEnabled: false,
        emailReminderDaysBefore: null,
      }),
    );
  });

  it("renders server field errors on both association pickers and the reminder switch", async () => {
    mockSubscriptionPage();
    vi.spyOn(api, "createSubscription").mockRejectedValue(
      new ApiError("The subscription could not be saved.", 422, "VALIDATION_ERROR", [
        { path: "categoryId", code: "INVALID_CATEGORY", message: "Category no longer exists." },
        {
          path: "paymentMethodId",
          code: "INVALID_PAYMENT_METHOD",
          message: "Payment method no longer exists.",
        },
        {
          path: "emailReminderEnabled",
          code: "REMINDER_UNAVAILABLE",
          message: "Email reminders are no longer available.",
        },
      ]),
    );
    renderRoute(<SubscriptionFormPage />, "/subscriptions/new", "/subscriptions/new");

    await screen.findByRole("checkbox", { name: /Email me before this estimated renewal/ });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Concurrent edit" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add subscription" }));

    const categoryError = await screen.findByText("Category no longer exists.");
    const paymentError = screen.getByText("Payment method no longer exists.");
    const reminderError = screen.getByText("Email reminders are no longer available.");
    expect(screen.getByRole("button", { name: /Category/ }).getAttribute("aria-describedby")).toBe(
      categoryError.id,
    );
    expect(
      screen.getByRole("button", { name: /Payment method/ }).getAttribute("aria-describedby"),
    ).toBe(paymentError.id);
    expect(
      screen
        .getByRole("checkbox", { name: /Email me before this estimated renewal/ })
        .getAttribute("aria-describedby"),
    ).toBe(reminderError.id);
  });

  it("edits an opted-in subscription from inherited timing to an explicit zero-day lead", async () => {
    const record = detail("scheduled", { emailReminderDaysBefore: null });
    mockSubscriptionPage({ record });
    const update = vi.spyOn(api, "updateSubscription").mockResolvedValue(record);
    renderRoute(
      <SubscriptionFormPage />,
      `/subscriptions/${record.id}/edit`,
      "/subscriptions/:subscriptionId/edit",
    );

    expect(
      await screen.findByRole<HTMLInputElement>("checkbox", {
        name: /Email me before this estimated renewal/,
      }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: /Use account default/ }).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Use a custom lead time/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Days before renewal/ }), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        emailReminderEnabled: true,
        emailReminderDaysBefore: 0,
      }),
    );
  });

  it("can return a persisted custom zero-day lead to the inherited account default", async () => {
    const record = detail("scheduled", { emailReminderDaysBefore: 0 });
    mockSubscriptionPage({ record });
    const update = vi.spyOn(api, "updateSubscription").mockResolvedValue(record);
    renderRoute(
      <SubscriptionFormPage />,
      `/subscriptions/${record.id}/edit`,
      "/subscriptions/:subscriptionId/edit",
    );

    expect(await screen.findByRole("spinbutton", { name: /Days before renewal/ })).toHaveProperty(
      "value",
      "0",
    );
    fireEvent.click(screen.getByRole("radio", { name: /Use account default/ }));
    expect(screen.queryByRole("spinbutton", { name: /Days before renewal/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        emailReminderEnabled: true,
        emailReminderDaysBefore: null,
      }),
    );
  });

  it("omits reminder controls for a new subscription when delivery is unavailable", async () => {
    mockSubscriptionPage({ emailReminders: false });
    renderRoute(<SubscriptionFormPage />, "/subscriptions/new", "/subscriptions/new");

    expect(await screen.findByRole("heading", { name: "Add subscription" })).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: /Email me before this estimated renewal/ }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Renewal email" })).toBeNull();
    expect(screen.queryByText(/not configured for this deployment/i)).toBeNull();
  });

  it("omits reminder controls for a saved opt-out when delivery is unavailable", async () => {
    const record = detail("none", { emailReminderEnabled: false });
    mockSubscriptionPage({ emailReminders: false, record });
    renderRoute(
      <SubscriptionFormPage />,
      `/subscriptions/${record.id}/edit`,
      "/subscriptions/:subscriptionId/edit",
    );

    expect(await screen.findByRole("heading", { name: "Edit subscription" })).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: /Email me before this estimated renewal/ }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Renewal email" })).toBeNull();
  });

  it("allows an unavailable deployment to disable a previously saved opt-in", async () => {
    const record = detail("paused");
    mockSubscriptionPage({ emailReminders: false, record });
    const update = vi.spyOn(api, "updateSubscription").mockResolvedValue({
      ...record,
      emailReminderEnabled: false,
    });
    renderRoute(
      <SubscriptionFormPage />,
      `/subscriptions/${record.id}/edit`,
      "/subscriptions/:subscriptionId/edit",
    );

    const turnOff = await screen.findByRole("button", { name: "Turn off reminder" });
    expect(screen.queryByRole("checkbox", { name: /Email me before/ })).toBeNull();
    fireEvent.click(turnOff);
    expect(screen.getByText(/will be turned off when you save changes/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ emailReminderEnabled: false }),
    );
  });

  it("does not expose a re-enable action after turning off an unavailable saved reminder", async () => {
    const record = detail("paused");
    mockSubscriptionPage({ emailReminders: false, record });
    const update = vi.spyOn(api, "updateSubscription").mockResolvedValue({
      ...record,
      emailReminderEnabled: false,
    });
    renderRoute(
      <SubscriptionFormPage />,
      `/subscriptions/${record.id}/edit`,
      "/subscriptions/:subscriptionId/edit",
    );

    fireEvent.click(await screen.findByRole("button", { name: "Turn off reminder" }));
    expect(screen.queryByRole("button", { name: "Turn off reminder" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Email me before/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ emailReminderEnabled: false }),
    );
  });

  it("clears detached resource ids before saving after successful resource loads", async () => {
    const record = detail("scheduled", {
      categoryId: "00000000-0000-4000-8000-000000000003",
      paymentMethodId: "00000000-0000-4000-8000-000000000004",
    });
    mockSubscriptionPage({ record });
    const update = vi.spyOn(api, "updateSubscription").mockResolvedValue({
      ...record,
      categoryId: null,
      paymentMethodId: null,
    });
    renderRoute(
      <SubscriptionFormPage />,
      `/subscriptions/${record.id}/edit`,
      "/subscriptions/:subscriptionId/edit",
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Category/ }).hasAttribute("disabled")).toBe(false);
      expect(screen.getByRole("button", { name: /Payment method/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ categoryId: null, paymentMethodId: null }),
    );
  });

  it("preserves existing resource ids when association lookups fail", async () => {
    const record = detail("scheduled", {
      categoryId: "00000000-0000-4000-8000-000000000003",
      paymentMethodId: "00000000-0000-4000-8000-000000000004",
    });
    mockSubscriptionPage({ record });
    vi.mocked(api.categories).mockRejectedValue(new Error("category lookup failed"));
    vi.mocked(api.paymentMethods).mockRejectedValue(new Error("payment lookup failed"));
    const update = vi.spyOn(api, "updateSubscription").mockResolvedValue(record);
    renderRoute(
      <SubscriptionFormPage />,
      `/subscriptions/${record.id}/edit`,
      "/subscriptions/:subscriptionId/edit",
    );

    expect(await screen.findAllByText(/choices could not be loaded/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        categoryId: record.categoryId,
        paymentMethodId: record.paymentMethodId,
      }),
    );
  });
});

describe("account renewal-email defaults", () => {
  it("saves email language independently without changing the interface language", async () => {
    vi.spyOn(api, "me").mockResolvedValue(user);
    vi.spyOn(api, "session").mockResolvedValue(session(user, false));
    const update = vi.spyOn(api, "updateMe").mockResolvedValue({
      ...user,
      emailLocale: "zh-Hans",
    });
    renderRoute(<ProfileSettingsPage />, "/settings/profile", "/settings/profile");

    const interfaceLanguage = await screen.findByRole("combobox", {
      name: "Interface language",
    });
    const emailLanguage = screen.getByRole("combobox", {
      name: /^Email language/,
    });
    fireEvent.change(emailLanguage, { target: { value: "zh-Hans" } });

    expect((interfaceLanguage as unknown as { value: string }).value).toBe("en");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ interfaceLocale: "en", emailLocale: "zh-Hans" }),
    );
  });

  it("saves timing defaults and a global pause without opting any subscription in", async () => {
    vi.spyOn(api, "me").mockResolvedValue(user);
    vi.spyOn(api, "session").mockResolvedValue(session(user, true));
    const update = vi.spyOn(api, "updateMe").mockResolvedValue({
      ...user,
      defaultEmailReminderDaysBefore: 0,
      emailReminderLocalTime: "23:00",
      emailRemindersPaused: true,
    });
    const client = renderRoute(<ProfileSettingsPage />, "/settings/profile", "/settings/profile");
    client.setQueryData(["subscriptions"], [subscription]);
    client.setQueryData(["subscription", subscription.id], detail("scheduled"));
    client.setQueryData(["dashboard"], { marker: "stale" });

    fireEvent.change(
      await screen.findByRole("spinbutton", { name: /Default days before renewal/ }),
      {
        target: { value: "0" },
      },
    );
    fireEvent.change(screen.getByRole("combobox", { name: /Local delivery hour/ }), {
      target: { value: "23:00" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Pause all email reminders/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        defaultEmailReminderDaysBefore: 0,
        emailReminderLocalTime: "23:00",
        emailRemindersPaused: true,
      }),
    );
    expect(update.mock.calls[0]?.[0]).not.toHaveProperty("emailReminderEnabled");
    await waitFor(() => {
      expect(client.getQueryState(["subscriptions"])?.isInvalidated).toBe(true);
      expect(client.getQueryState(["subscription", subscription.id])?.isInvalidated).toBe(true);
      expect(client.getQueryState(["dashboard"])?.isInvalidated).toBe(true);
    });
  });

  it("omits unavailable reminder controls without showing a provider warning", async () => {
    const pausedUser = { ...user, emailRemindersPaused: true };
    vi.spyOn(api, "me").mockResolvedValue(pausedUser);
    vi.spyOn(api, "session").mockResolvedValue(session(pausedUser, false));
    renderRoute(<ProfileSettingsPage />, "/settings/profile", "/settings/profile");

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Pause all email reminders/ })).toBeNull();
    expect(screen.queryByText(/not configured for this deployment/i)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Interface language" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /^Email language/ })).toBeTruthy();
  });

  it("keeps the two language fields in one explicit grid and renders email as read-only text", async () => {
    vi.spyOn(api, "me").mockResolvedValue(user);
    vi.spyOn(api, "session").mockResolvedValue(session(user, false));
    renderRoute(<ProfileSettingsPage />, "/settings/profile", "/settings/profile");

    const interfaceLanguage = await screen.findByRole("combobox", {
      name: "Interface language",
    });
    const emailLanguage = screen.getByRole("combobox", { name: /^Email language/ });
    const languageFields = interfaceLanguage.closest(".settings-language__fields");

    expect(languageFields).toBeTruthy();
    expect(emailLanguage.closest(".settings-language__fields")).toBe(languageFields);
    expect(languageFields?.children).toHaveLength(2);
    expect(screen.getByText(user.email).closest("label")).toBeNull();
  });

  it("blocks unpausing while the account is safety-suspended", async () => {
    const suspendedUser = {
      ...user,
      emailRemindersPaused: true,
      emailReminderSystemSuspended: true,
    };
    vi.spyOn(api, "me").mockResolvedValue(suspendedUser);
    vi.spyOn(api, "session").mockResolvedValue(session(suspendedUser, true));
    renderRoute(<ProfileSettingsPage />, "/settings/profile", "/settings/profile");

    const pause = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: /Pause all email reminders/,
    });
    expect(pause.checked).toBe(true);
    expect(pause.disabled).toBe(true);
  });
});

describe("renewal-email delivery summary", () => {
  it("shows an explicit subscription opt-out as off even if a stale delivery summary exists", async () => {
    const record = {
      ...detail("sent"),
      emailReminderEnabled: false,
    };
    mockSubscriptionPage({ record });
    renderRoute(
      <SubscriptionDetailPage />,
      `/subscriptions/${record.id}`,
      "/subscriptions/:subscriptionId",
    );

    expect(await screen.findByText("Off")).toBeTruthy();
    expect(screen.getByText(/Account defaults do not opt it in automatically/)).toBeTruthy();
    expect(screen.queryByText("Sent")).toBeNull();
  });

  it("does not offer reminder configuration for an opt-out when delivery is unavailable", async () => {
    const record = detail("none", { emailReminderEnabled: false });
    mockSubscriptionPage({ emailReminders: false, record });
    renderRoute(
      <SubscriptionDetailPage />,
      `/subscriptions/${record.id}`,
      "/subscriptions/:subscriptionId",
    );

    expect(await screen.findByText("Off")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Configure reminder" })).toBeNull();
  });

  it("keeps a turn-off path for an enabled reminder when delivery is unavailable", async () => {
    const record = detail("paused");
    mockSubscriptionPage({ emailReminders: false, record });
    renderRoute(
      <SubscriptionDetailPage />,
      `/subscriptions/${record.id}`,
      "/subscriptions/:subscriptionId",
    );

    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Turn off reminder" }).getAttribute("href")).toBe(
      `/subscriptions/${record.id}/edit`,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["none", "Not planned"],
    ["scheduled", "Scheduled"],
    ["paused", "Paused"],
    ["retrying", "Retrying"],
    ["sent", "Sent"],
    ["failed", "Failed"],
    ["unknown", "Delivery unknown"],
    ["expired", "Expired"],
  ] as const)("renders the provider-neutral %s state", async (state, label) => {
    const record = detail(state);
    mockSubscriptionPage({ record });
    renderRoute(
      <SubscriptionDetailPage />,
      `/subscriptions/${record.id}`,
      "/subscriptions/:subscriptionId",
    );

    expect(await screen.findByText(label)).toBeTruthy();
  });

  it("does not expose provider identifiers or raw delivery errors", async () => {
    const record = {
      ...detail("unknown"),
      emailReminderDelivery: {
        ...detail("unknown").emailReminderDelivery,
        providerMessageId: "provider-message-secret",
        lastError: "smtp raw 550 mailbox detail",
      },
    } as SubscriptionDetail;
    mockSubscriptionPage({ record });
    renderRoute(
      <SubscriptionDetailPage />,
      `/subscriptions/${record.id}`,
      "/subscriptions/:subscriptionId",
    );

    await screen.findByText("Delivery unknown");
    expect(document.body.textContent).not.toContain("provider-message-secret");
    expect(document.body.textContent).not.toContain("smtp raw 550 mailbox detail");
  });
});

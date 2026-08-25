// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../../src/web/api/types";
import { api } from "../../../src/web/api/client";
import { App } from "../../../src/web/app/App";
import i18n, { setLanguage } from "../../../src/web/i18n";

const session: Session = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner@example.test",
    displayName: null,
    timezone: "Asia/Shanghai",
    reportingCurrency: "CNY",
    onboardingCompletedAt: "2026-08-01T00:00:00.000Z",
    interfaceLocale: "zh-Hans",
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
};

beforeEach(async () => {
  await setLanguage("en");
  window.history.replaceState({}, "", "/not-a-real-route");
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  document.documentElement.lang = "en";
});

describe("authenticated interface locale", () => {
  it("uses the saved profile locale instead of stale browser storage", async () => {
    vi.spyOn(api, "session").mockResolvedValue(session);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "找不到这个订阅" })).toBeTruthy();
    expect(i18n.language).toBe("zh-Hans");
    expect(document.documentElement.lang).toBe("zh-Hans");
    expect(localStorage.getItem("opensublists-language")).toBe("zh-Hans");
  });
});

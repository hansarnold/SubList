// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ImportResult } from "../../../src/shared/api-types";
import i18n from "../../../src/web/i18n";
import { ImportResultSummary } from "../../../src/web/features/settings/SettingsPages";

const result: ImportResult = {
  created: { categories: 1, paymentMethods: 2, subscriptions: 3 },
  updated: { categories: 1, paymentMethods: 0, subscriptions: 2 },
  skipped: { categories: 0, paymentMethods: 1, subscriptions: 0 },
  warnings: [
    { path: "legacyOne", code: "UNSUPPORTED_SOURCE_FIELD", message: "First warning" },
    { path: "legacyTwo", code: "UNSUPPORTED_SOURCE_FIELD", message: "Second warning" },
  ],
  reminderImpact: {
    enabledPreferencesAfterApply: 0,
    senderCapabilityAvailable: true,
    willForceGlobalPause: false,
  },
};

afterEach(() => cleanup());

function expectCount(label: string, value: number) {
  const labelNode = screen.getByText(label);
  expect(within(labelNode.parentElement as HTMLElement).getByText(String(value))).toBeTruthy();
}

describe("import result summary", () => {
  it("renders created, updated, skipped, and warning totals in English and Chinese", async () => {
    await i18n.changeLanguage("en");
    const english = render(<ImportResultSummary result={result} />);
    expect(screen.getByText("Import complete.")).toBeTruthy();
    expectCount("Created", 6);
    expectCount("Updated", 3);
    expectCount("Skipped", 1);
    expectCount("Warnings", 2);
    english.unmount();

    await i18n.changeLanguage("zh-Hans");
    render(<ImportResultSummary result={result} />);
    expect(screen.getByText("导入完成。")).toBeTruthy();
    expectCount("已创建", 6);
    expectCount("已更新", 3);
    expectCount("已跳过", 1);
    expectCount("警告", 2);
  });
});

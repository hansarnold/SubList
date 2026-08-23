import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { ExchangeRateProvider } from "../../src/application/fx-service";
import worker, { createWorker } from "../../src/worker";

const migrations = inject("migrations");
const ORIGIN = "http://localhost:5173";

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM fx_rates"),
    env.DB.prepare("DELETE FROM fx_snapshot"),
  ]);
});

describe("refactor Worker routes", () => {
  it("creates a reviewed category batch atomically", async () => {
    const response = await request("/api/v1/categories/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        categories: [
          {
            name: "Productivity",
            color: "#6366F1",
            symbol: { type: "icon", value: "briefcase" },
            position: 0,
          },
          {
            name: "Utilities",
            color: "#0EA5E9",
            symbol: { type: "emoji", value: "💡" },
            position: 1,
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json<{
      data: Array<{ name: string; symbol: { type: string; value: string } }>;
    }>();
    expect(body.data).toEqual([
      expect.objectContaining({
        name: "Productivity",
        symbol: { type: "icon", value: "briefcase" },
      }),
      expect.objectContaining({
        name: "Utilities",
        symbol: { type: "emoji", value: "💡" },
      }),
    ]);
    expect(await env.DB.prepare("SELECT COUNT(*) FROM categories").first<number>("COUNT(*)")).toBe(
      2,
    );
  });

  it("completes onboarding with no body or an empty JSON object", async () => {
    const first = await request("/api/v1/onboarding/complete", {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ data: { onboardingCompletedAt: string | null } }>();
    expect(firstBody.data.onboardingCompletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const second = await request("/api/v1/onboarding/complete", {
      method: "POST",
      headers: jsonHeaders(),
      body: "{}",
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json<{ data: { onboardingCompletedAt: string | null } }>();
    expect(secondBody.data.onboardingCompletedAt).toBe(firstBody.data.onboardingCompletedAt);
  });

  it("same-origin protects onboarding completion", async () => {
    const response = await request("/api/v1/onboarding/complete", { method: "POST" });
    expect(response.status).toBe(400);
    const body = await response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INVALID_ORIGIN");
  });
});

describe("scheduled exchange-rate refresh", () => {
  it("awaits the provider and stores one complete snapshot", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const scheduledWorker = createWorker(() => fixedProvider("2026-08-22"));

    await scheduledWorker.scheduled(
      createScheduledController({
        cron: "15 18 * * *",
        scheduledTime: Date.UTC(2026, 7, 23, 18, 15),
      }),
      env,
    );

    const snapshot = await env.DB.prepare(
      `SELECT provider, rate_date, base_currency, fetched_at, rate_count
       FROM fx_snapshot WHERE id = 1`,
    ).first<{
      provider: string;
      rate_date: string;
      base_currency: string;
      fetched_at: number;
      rate_count: number;
    }>();
    expect(snapshot).toMatchObject({
      provider: "ecb",
      rate_date: "2026-08-22",
      base_currency: "EUR",
      rate_count: 3,
    });
    expect(snapshot?.fetched_at).toBeGreaterThan(0);
    const rates = await env.DB.prepare(
      "SELECT currency, units_per_eur FROM fx_rates ORDER BY currency",
    ).all<{ currency: string; units_per_eur: string }>();
    expect(rates.results).toEqual([
      { currency: "CNY", units_per_eur: "8.4" },
      { currency: "EUR", units_per_eur: "1" },
      { currency: "USD", units_per_eur: "1.18" },
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"message":"fx_refresh_complete"'));
    log.mockRestore();
  });

  it("logs a safe failure record and rethrows refresh failures", async () => {
    const privateProviderMessage = "private upstream response details";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const scheduledWorker = createWorker(() => ({
      fetchLatest() {
        return Promise.reject(new Error(privateProviderMessage));
      },
    }));

    await expect(
      scheduledWorker.scheduled(
        createScheduledController({
          cron: "15 18 * * *",
          scheduledTime: Date.UTC(2026, 7, 23, 18, 15),
        }),
        env,
      ),
    ).rejects.toThrow(privateProviderMessage);

    const serializedLog = String(errorLog.mock.calls[0]?.[0]);
    expect(JSON.parse(serializedLog)).toMatchObject({
      message: "fx_refresh_failed",
      provider: "ecb",
      cron: "15 18 * * *",
      errorCode: "FX_REFRESH_FAILED",
    });
    expect(serializedLog).not.toContain(privateProviderMessage);
    errorLog.mockRestore();
  });
});

function fixedProvider(rateDate: string): ExchangeRateProvider {
  return {
    fetchLatest() {
      return Promise.resolve({
        provider: "ecb",
        rateDate,
        baseCurrency: "EUR",
        rates: [
          { currency: "CNY", unitsPerEur: "8.4" },
          { currency: "EUR", unitsPerEur: "1" },
          { currency: "USD", unitsPerEur: "1.18" },
        ],
      });
    },
  };
}

function jsonHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Origin: ORIGIN,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    worker.fetch(new Request(`${ORIGIN}${path}`, init), env, createExecutionContext()),
  );
}

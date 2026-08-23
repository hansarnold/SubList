import { describe, expect, it, vi } from "vitest";

import { EcbExchangeRateProvider, EcbProviderError, parseEcbCsv } from "../../../src/worker/fx/ecb";

const HEADER = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE";
const CURRENT_CURRENCIES = [
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "USD",
  "ZAR",
] as const;

function rateRow(currency: string, date = "2026-08-21", value = "1.25"): string {
  return `EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${date},${value}`;
}

function validCsv(extraRows: string[] = []): string {
  return [
    HEADER,
    rateRow("ARS", "2020-10-30", "91.5953"),
    ...CURRENT_CURRENCIES.map((currency, index) =>
      rateRow(currency, "2026-08-21", `${index + 1}.2500`),
    ),
    ...extraRows,
  ].join("\r\n");
}

describe("ECB CSV adapter", () => {
  it("selects one latest-date snapshot and canonicalizes its exact rates", () => {
    const result = parseEcbCsv(validCsv());

    expect(result.rateDate).toBe("2026-08-21");
    expect(result.rates.find((rate) => rate.currency === "EUR")?.unitsPerEur).toBe("1");
    expect(result.rates.find((rate) => rate.currency === "USD")?.unitsPerEur).toBe("19.25");
    expect(result.rates.some((rate) => rate.currency === "ARS")).toBe(false);
  });

  it("ignores valid provider currencies outside the application allow-list", () => {
    const result = parseEcbCsv(validCsv([rateRow("ATS", "1998-12-31", "13.7603")]));

    expect(result.rates.some((rate) => rate.currency === "ATS")).toBe(false);
    expect(result.rates.find((rate) => rate.currency === "USD")?.unitsPerEur).toBe("19.25");
  });

  it("rejects duplicate, non-positive, malformed, and incomplete latest snapshots", () => {
    expect(() => parseEcbCsv(validCsv([rateRow("USD")]))).toThrow(EcbProviderError);
    expect(() =>
      parseEcbCsv(
        validCsv().replace(
          rateRow("USD", "2026-08-21", "19.2500"),
          rateRow("USD", "2026-08-21", "0"),
        ),
      ),
    ).toThrow(EcbProviderError);
    expect(() => parseEcbCsv("FREQ,CURRENCY\nD,USD")).toThrow(EcbProviderError);
    expect(() => parseEcbCsv(validCsv([rateRow("USDX")]))).toThrow(EcbProviderError);
    expect(() =>
      parseEcbCsv(
        validCsv().replace(
          rateRow("USD", "2026-08-21", "19.2500"),
          rateRow("USD", "2020-01-01", "1"),
        ),
      ),
    ).toThrow(/sentinel currency USD/);
  });

  it("uses a bounded HTTP read and the verified official response shape", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(validCsv(), {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        }),
      ),
    );
    const provider = new EcbExchangeRateProvider(fetcher, 1_000, 32 * 1024);

    await expect(provider.fetchLatest()).resolves.toMatchObject({
      provider: "ecb",
      baseCurrency: "EUR",
      rateDate: "2026-08-21",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("calls the default global fetch with the Workers-compatible receiver", async () => {
    const globalFetcher = vi.fn(function () {
      return Promise.resolve(
        new Response(validCsv(), {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        }),
      );
    });
    vi.stubGlobal("fetch", globalFetcher);

    try {
      await expect(new EcbExchangeRateProvider().fetchLatest()).resolves.toMatchObject({
        provider: "ecb",
        rateDate: "2026-08-21",
      });
      expect(globalFetcher.mock.contexts[0]).toBe(globalThis);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects HTTP failures and declared oversized responses", async () => {
    const failed = new EcbExchangeRateProvider(() =>
      Promise.resolve(new Response("no", { status: 503 })),
    );
    const oversized = new EcbExchangeRateProvider(
      () =>
        Promise.resolve(
          new Response(validCsv(), {
            headers: { "Content-Length": "999999" },
          }),
        ),
      1_000,
      1024,
    );

    await expect(failed.fetchLatest()).rejects.toThrow(/HTTP 503/);
    await expect(oversized.fetchLatest()).rejects.toThrow(/too large/);
  });
});

import type {
  ExchangeRateProvider,
  ExchangeRateProviderSnapshot,
} from "../../application/fx-service";
import {
  assertCurrencyCode,
  assertIsoCalendarDate,
  canonicalizePositiveDecimal,
  type CurrencyCode,
  type FxRate,
} from "../../domain";

export const ECB_LATEST_RATES_URL =
  "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1&detail=dataonly&format=csvdata";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;
const MIN_CURRENT_RATE_COUNT = 20;
const REQUIRED_SENTINEL_CURRENCIES = ["CNY", "CHF", "GBP", "JPY", "USD"] as const;
const REQUIRED_COLUMNS = [
  "FREQ",
  "CURRENCY",
  "CURRENCY_DENOM",
  "EXR_TYPE",
  "EXR_SUFFIX",
  "TIME_PERIOD",
  "OBS_VALUE",
] as const;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class EcbProviderError extends Error {
  readonly code = "ECB_PROVIDER_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EcbProviderError";
  }
}

export class EcbExchangeRateProvider implements ExchangeRateProvider {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  ) {}

  async fetchLatest(): Promise<ExchangeRateProviderSnapshot> {
    let response: Response;
    try {
      response = await this.fetcher(ECB_LATEST_RATES_URL, {
        headers: { Accept: "text/csv" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new EcbProviderError("The ECB exchange-rate request failed.", { cause: error });
    }

    if (!response.ok) {
      throw new EcbProviderError(`The ECB exchange-rate request returned HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
      throw new EcbProviderError("The ECB exchange-rate response is too large.");
    }

    const csv = await readBoundedText(response, this.maxResponseBytes);
    return parseEcbCsv(csv);
  }
}

export function parseEcbCsv(csv: string): ExchangeRateProviderSnapshot {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new EcbProviderError("The ECB response contains no rate rows.");

  const header = parseCsvLine(lines[0] ?? "");
  const indexes = Object.fromEntries(header.map((name, index) => [name, index])) as Record<
    string,
    number | undefined
  >;
  for (const column of REQUIRED_COLUMNS) {
    if (indexes[column] === undefined) {
      throw new EcbProviderError(`The ECB response is missing the ${column} column.`);
    }
  }

  const parsedRows: Array<{ currency: CurrencyCode; rateDate: string; unitsPerEur: string }> = [];
  for (const [lineIndex, line] of lines.slice(1).entries()) {
    const values = parseCsvLine(line);
    const value = (column: string): string => values[indexes[column] ?? -1] ?? "";
    if (
      value("FREQ") !== "D" ||
      value("CURRENCY_DENOM") !== "EUR" ||
      value("EXR_TYPE") !== "SP00" ||
      value("EXR_SUFFIX") !== "A"
    ) {
      throw new EcbProviderError(`The ECB response row ${lineIndex + 2} has an unexpected key.`);
    }

    try {
      parsedRows.push({
        currency: assertCurrencyCode(value("CURRENCY")),
        rateDate: assertIsoCalendarDate(value("TIME_PERIOD")),
        unitsPerEur: canonicalizePositiveDecimal(value("OBS_VALUE")),
      });
    } catch (error) {
      throw new EcbProviderError(`The ECB response row ${lineIndex + 2} is invalid.`, {
        cause: error,
      });
    }
  }

  const rateDate = parsedRows.reduce(
    (latest, row) => (row.rateDate > latest ? row.rateDate : latest),
    "0001-01-01",
  );
  const ratesByCurrency = new Map<CurrencyCode, FxRate>();
  ratesByCurrency.set("EUR", { currency: "EUR", unitsPerEur: "1" });
  for (const row of parsedRows) {
    if (row.rateDate !== rateDate) continue;
    if (ratesByCurrency.has(row.currency)) {
      throw new EcbProviderError(
        `The ECB response repeats ${row.currency} for rate date ${rateDate}.`,
      );
    }
    ratesByCurrency.set(row.currency, {
      currency: row.currency,
      unitsPerEur: row.unitsPerEur,
    });
  }

  if (ratesByCurrency.size < MIN_CURRENT_RATE_COUNT) {
    throw new EcbProviderError(
      `The ECB response contains only ${ratesByCurrency.size} current rates.`,
    );
  }
  for (const currency of REQUIRED_SENTINEL_CURRENCIES) {
    if (!ratesByCurrency.has(currency)) {
      throw new EcbProviderError(`The ECB response is missing sentinel currency ${currency}.`);
    }
  }

  return {
    provider: "ecb",
    baseCurrency: "EUR",
    rateDate,
    rates: [...ratesByCurrency.values()].sort((left, right) =>
      left.currency.localeCompare(right.currency),
    ),
  };
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) throw new EcbProviderError("The ECB response body is empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let receivedBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel();
        throw new EcbProviderError("The ECB exchange-rate response is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof EcbProviderError) throw error;
    throw new EcbProviderError("The ECB exchange-rate response could not be read.", {
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new EcbProviderError("The ECB response contains malformed CSV quoting.");
  values.push(value);
  return values;
}

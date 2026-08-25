export type BreakdownCurrencyAmount = {
  currency: string;
  monthlyEstimate: string;
};

export type BreakdownInput = {
  key: string;
  label: string;
  color: string | null;
  subscriptionCount: number;
  reportingMonthlyAverage: string | null;
  totalsByCurrency: readonly BreakdownCurrencyAmount[];
};

export type BreakdownRow = BreakdownInput & {
  amountMicros: bigint | null;
  chartValue: number;
  chartColor: string;
  share: number | null;
};

export type BreakdownModel = {
  state: "empty" | "unavailable" | "zero" | "single" | "ready";
  rows: BreakdownRow[];
  chartRows: BreakdownRow[];
  totalMicros: bigint | null;
};

const CHART_PALETTE = [
  "#2563EB",
  "#059669",
  "#7C3AED",
  "#D97706",
  "#DB2777",
  "#0891B2",
  "#4F46E5",
] as const;

export function parseBreakdownAmountToMicros(value: string): bigint {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new RangeError(`Invalid Dashboard amount: ${value}`);
  const [whole = "0"] = value.split(".");
  const fraction = match[1] ?? "";
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function percentage(amount: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((amount * 10_000n + total / 2n) / total) / 100;
}

function compareRows(left: BreakdownRow, right: BreakdownRow): number {
  if (left.amountMicros !== null && right.amountMicros !== null) {
    if (left.amountMicros > right.amountMicros) return -1;
    if (left.amountMicros < right.amountMicros) return 1;
  }
  return left.label.localeCompare(right.label);
}

function mergeCurrencyAmounts(rows: readonly BreakdownRow[]): BreakdownCurrencyAmount[] {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    for (const total of row.totalsByCurrency) {
      totals.set(
        total.currency,
        (totals.get(total.currency) ?? 0n) + parseBreakdownAmountToMicros(total.monthlyEstimate),
      );
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, micros]) => ({ currency, monthlyEstimate: formatMicros(micros) }));
}

function formatMicros(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function buildBreakdownModel(
  items: readonly BreakdownInput[],
  otherLabel: string,
): BreakdownModel {
  if (items.length === 0) {
    return { state: "empty", rows: [], chartRows: [], totalMicros: 0n };
  }

  if (items.some((item) => item.reportingMonthlyAverage === null)) {
    const rows = items
      .map<BreakdownRow>((item, index) => ({
        ...item,
        amountMicros: null,
        chartValue: 0,
        chartColor: CHART_PALETTE[index % CHART_PALETTE.length] ?? "#2563EB",
        share: null,
      }))
      .sort(
        (left, right) =>
          right.subscriptionCount - left.subscriptionCount || left.label.localeCompare(right.label),
      );
    return { state: "unavailable", rows, chartRows: [], totalMicros: null };
  }

  const parsed = items.map((item, index) => {
    const amountMicros = parseBreakdownAmountToMicros(item.reportingMonthlyAverage ?? "0");
    return {
      ...item,
      amountMicros,
      chartValue: Number(amountMicros) / 1_000_000,
      chartColor: CHART_PALETTE[index % CHART_PALETTE.length] ?? "#2563EB",
      share: null,
    } satisfies BreakdownRow;
  });
  const totalMicros = parsed.reduce((sum, item) => sum + (item.amountMicros ?? 0n), 0n);
  const rows = parsed
    .map((item) => ({
      ...item,
      share: percentage(item.amountMicros ?? 0n, totalMicros),
    }))
    .sort(compareRows);
  const positiveRows = rows.filter((item) => (item.amountMicros ?? 0n) > 0n);

  if (positiveRows.length === 0) {
    return { state: "zero", rows, chartRows: [], totalMicros };
  }
  if (positiveRows.length === 1) {
    return { state: "single", rows, chartRows: positiveRows, totalMicros };
  }

  let chartRows = positiveRows;
  if (positiveRows.length > 6) {
    const retained = positiveRows.slice(0, 5);
    const grouped = positiveRows.slice(5);
    const otherMicros = grouped.reduce((sum, item) => sum + (item.amountMicros ?? 0n), 0n);
    chartRows = [
      ...retained,
      {
        key: "__other__",
        label: otherLabel,
        color: null,
        subscriptionCount: grouped.reduce((sum, item) => sum + item.subscriptionCount, 0),
        reportingMonthlyAverage: formatMicros(otherMicros),
        totalsByCurrency: mergeCurrencyAmounts(grouped),
        amountMicros: otherMicros,
        chartValue: Number(otherMicros) / 1_000_000,
        chartColor: CHART_PALETTE[5] ?? "#0891B2",
        share: percentage(otherMicros, totalMicros),
      },
    ];
  }

  return { state: "ready", rows, chartRows, totalMicros };
}

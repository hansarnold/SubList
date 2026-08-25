import { describe, expect, it } from "vitest";
import {
  buildBreakdownModel,
  parseBreakdownAmountToMicros,
  type BreakdownInput,
} from "../../../src/web/features/dashboard/breakdown-model";

function item(
  key: string,
  amount: string | null,
  options: Partial<BreakdownInput> = {},
): BreakdownInput {
  return {
    key,
    label: key,
    color: null,
    subscriptionCount: 1,
    reportingMonthlyAverage: amount,
    totalsByCurrency: amount === null ? [{ currency: "USD", monthlyEstimate: "10" }] : [],
    ...options,
  };
}

describe("Dashboard breakdown model", () => {
  it("parses API decimal amounts without floating-point arithmetic", () => {
    expect(parseBreakdownAmountToMicros("0")).toBe(0n);
    expect(parseBreakdownAmountToMicros("12.345678")).toBe(12_345_678n);
    expect(() => parseBreakdownAmountToMicros("1.0000001")).toThrow(RangeError);
  });

  it("sorts, sizes, and calculates shares from the same monthly amount", () => {
    const model = buildBreakdownModel(
      [item("small", "1"), item("large", "3"), item("zero", "0")],
      "Other",
    );

    expect(model.state).toBe("ready");
    expect(model.rows.map((row) => row.key)).toEqual(["large", "small", "zero"]);
    expect(model.rows.map((row) => row.share)).toEqual([75, 25, 0]);
    expect(model.chartRows.map((row) => row.chartValue)).toEqual([3, 1]);
  });

  it("groups chart-only overflow into Other while retaining every text row", () => {
    const model = buildBreakdownModel(
      Array.from({ length: 7 }, (_, index) =>
        item(`group-${index + 1}`, String(7 - index), {
          totalsByCurrency: [{ currency: "USD", monthlyEstimate: String(7 - index) }],
        }),
      ),
      "Other",
    );

    expect(model.rows).toHaveLength(7);
    expect(model.chartRows).toHaveLength(6);
    expect(model.chartRows.at(-1)).toMatchObject({
      key: "__other__",
      label: "Other",
      reportingMonthlyAverage: "3",
      totalsByCurrency: [{ currency: "USD", monthlyEstimate: "3" }],
    });
  });

  it("keeps six positive groups distinct and only groups when there are more than six", () => {
    const model = buildBreakdownModel(
      Array.from({ length: 6 }, (_, index) => item(`group-${index + 1}`, String(6 - index))),
      "Other",
    );

    expect(model.chartRows).toHaveLength(6);
    expect(model.chartRows.some((row) => row.key === "__other__")).toBe(false);
  });

  it("keeps unavailable, zero, and single-group states explicit", () => {
    expect(buildBreakdownModel([], "Other").state).toBe("empty");
    expect(buildBreakdownModel([item("missing", null)], "Other").state).toBe("unavailable");
    expect(buildBreakdownModel([item("zero", "0")], "Other").state).toBe("zero");
    const single = buildBreakdownModel([item("only", "9.99")], "Other");
    expect(single.state).toBe("single");
    expect(single.chartRows[0]?.share).toBe(100);
  });
});

import { describe, expect, it } from "vitest";

import { previewOccurrences } from "../../../src/web/utils/format";

describe("subscription occurrence preview", () => {
  it("projects backward from a known future yearly occurrence", () => {
    expect(
      previewOccurrences(
        {
          unit: "year",
          count: 1,
          anchorOn: "2027-08-19",
          anchorMode: "calendar_day",
        },
        3,
        "2026-01-01",
      ),
    ).toEqual(["2026-08-19", "2027-08-19", "2028-08-19"]);
  });

  it("preserves end-of-month projection before and after the known anchor", () => {
    expect(
      previewOccurrences(
        {
          unit: "month",
          count: 1,
          anchorOn: "2026-03-31",
          anchorMode: "end_of_month",
        },
        3,
        "2026-01-01",
      ),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

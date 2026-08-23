import { describe, expect, it } from "vitest";

import {
  hasExactlyOneCurrencyFilter,
  normalizeSubscriptionListParams,
} from "../../../src/web/features/subscriptions/search-params";

describe("subscription list search parameters", () => {
  it("keeps amount sorting only with exactly one currency filter", () => {
    const valid = new URLSearchParams("currency=USD&sort=amount&order=desc");
    expect(hasExactlyOneCurrencyFilter(valid)).toBe(true);
    expect(normalizeSubscriptionListParams(valid).toString()).toBe(
      "currency=USD&sort=amount&order=desc",
    );

    for (const query of [
      "sort=amount&order=desc",
      "currency=&sort=amount&order=desc",
      "currency=USD&currency=CNY&sort=amount&order=desc",
    ]) {
      const normalized = normalizeSubscriptionListParams(new URLSearchParams(query));
      expect(normalized.has("sort")).toBe(false);
      expect(normalized.has("order")).toBe(false);
    }
  });

  it("does not change non-amount sorting", () => {
    const params = new URLSearchParams("sort=name&order=asc");
    expect(normalizeSubscriptionListParams(params).toString()).toBe("sort=name&order=asc");
  });
});

export function hasExactlyOneCurrencyFilter(searchParams: URLSearchParams): boolean {
  const currencies = searchParams.getAll("currency");
  return currencies.length === 1 && currencies[0] !== "";
}

export function normalizeSubscriptionListParams(searchParams: URLSearchParams): URLSearchParams {
  const normalized = new URLSearchParams(searchParams);
  if (normalized.get("sort") === "amount" && !hasExactlyOneCurrencyFilter(normalized)) {
    normalized.delete("sort");
    normalized.delete("order");
  }
  return normalized;
}

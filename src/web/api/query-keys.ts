export const sessionQueryKey = ["session"] as const;

export function categoriesQueryKey(userId: string) {
  return ["categories", userId] as const;
}

export function paymentMethodsQueryKey(userId: string) {
  return ["payment-methods", userId] as const;
}

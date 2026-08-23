export function normalizeCategoryNameKey(name: string): string {
  return name
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{White_Space}+/gu, " ");
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

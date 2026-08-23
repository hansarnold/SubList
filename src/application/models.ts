import type {
  AnchorMode,
  PaymentMethodKind,
  RecurrenceUnit,
  SubscriptionStatus,
} from "../shared/api-types";
import type { ResourceSymbol } from "../domain";

export type AuthenticatedIdentity = {
  provider: "cloudflare_access" | "local_development";
  subject: string;
  email: string;
};

export type AppUser = {
  id: string;
  primaryEmail: string;
  displayName: string | null;
  timezone: string;
  reportingCurrency: string;
  onboardingCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AppCategory = {
  id: string;
  name: string;
  nameKey: string;
  color: string;
  symbol: ResourceSymbol;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type AppPaymentMethod = {
  id: string;
  name: string;
  kind: PaymentMethodKind;
  label: string | null;
  symbol: ResourceSymbol;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type AppSubscription = {
  id: string;
  name: string;
  amountMicros: number;
  currency: string;
  recurrence: {
    unit: RecurrenceUnit;
    count: number;
    anchorOn: string;
    anchorMode: AnchorMode;
  };
  nextBillingOn: string | null;
  status: SubscriptionStatus;
  cancelledAt: number | null;
  archivedAt: number | null;
  categoryId: string | null;
  paymentMethodId: string | null;
  symbol: ResourceSymbol;
  websiteUrl: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AppDashboardSubscription = AppSubscription & {
  category: { id: string; name: string; color: string; symbol: ResourceSymbol } | null;
  paymentMethod: {
    id: string;
    name: string;
    kind: PaymentMethodKind;
    symbol: ResourceSymbol;
  } | null;
};

export type SubscriptionListFilter = {
  query?: string;
  status?: SubscriptionStatus;
  archived: "exclude" | "only" | "include";
  categoryId?: string | null;
  paymentMethodId?: string | null;
  currency?: string;
  sort: "nextBillingOn" | "name" | "amount" | "createdAt";
  order: "asc" | "desc";
};

export type ExistingImportState = {
  categoryIds: Set<string>;
  paymentMethodIds: Set<string>;
  subscriptionIds: Set<string>;
  categoryNameKeysById: Map<string, string>;
};

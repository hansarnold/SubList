import type {
  AnchorMode,
  PaymentMethodKind,
  RecurrenceUnit,
  SubscriptionStatus,
} from "../shared/api-types";
import type { ResourceSymbol } from "../domain";
import type { ReminderLocale } from "../domain";

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
  interfaceLocale: ReminderLocale;
  emailLocale: ReminderLocale;
  defaultEmailReminderDaysBefore: number;
  emailReminderLocalTime: string;
  emailRemindersPaused: boolean;
  emailReminderRevision: number;
  emailReminderSuspensionReason: "identity_email_conflict" | null;
  /** Internal-only collision candidate. Never expose through API, archives, or logs. */
  emailReminderSuspensionEmailNormalized: string | null;
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
  emailReminderEnabled: boolean;
  emailReminderDaysBefore: number | null;
  emailReminderRevision: number;
  createdAt: number;
  updatedAt: number;
};

export const RENEWAL_EMAIL_DELIVERY_STATUSES = [
  "pending",
  "sending",
  "retry_wait",
  "sent",
  "failed",
  "unknown",
  "cancelled",
  "expired",
] as const;

export type RenewalEmailDeliveryStatus = (typeof RENEWAL_EMAIL_DELIVERY_STATUSES)[number];

export type AppRenewalEmailDelivery = {
  id: string;
  userId: string;
  subscriptionId: string;
  billingOn: string;
  effectiveDaysBefore: number;
  intendedSendAt: number;
  expiresAt: number;
  status: RenewalEmailDeliveryStatus;
  attemptCount: number;
  claimedAt: number | null;
  leaseExpiresAt: number | null;
  nextAttemptAt: number | null;
  sentAt: number | null;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  providerKey: string | null;
  providerConfigRevision: number | null;
  applicationIdempotencyKey: string | null;
  templateVersion: number | null;
  plannedUserReminderRevision: number;
  plannedSubscriptionReminderRevision: number;
  createdAt: number;
  updatedAt: number;
};

export type ReminderPlanningCandidate = {
  user: AppUser;
  subscription: AppSubscription;
};

export type ReminderDeliveryCandidate = ReminderPlanningCandidate & {
  delivery: AppRenewalEmailDelivery;
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
  resourceRevision: number;
  categoryIds: Set<string>;
  paymentMethodIds: Set<string>;
  subscriptionIds: Set<string>;
  categoryNameKeysById: Map<string, string>;
  emailReminderEnabledBySubscriptionId: Map<string, boolean>;
};

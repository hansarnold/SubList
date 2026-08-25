import type { ResourceSymbol } from "../../domain";

export type { CommonIconKey, ResourceSymbol } from "../../domain";

export type ApiData<T> = { data: T };

export type ApiList<T> = {
  data: T[];
  meta: { count: number };
};

export type ApiErrorDetail = {
  path: string;
  code: string;
  message: string;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId: string;
  };
};

export type User = {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  reportingCurrency: string;
  onboardingCompletedAt: string | null;
  interfaceLocale: "en" | "zh-Hans";
  emailLocale: "en" | "zh-Hans";
  defaultEmailReminderDaysBefore: number;
  emailReminderLocalTime: string;
  emailRemindersPaused: boolean;
  emailReminderSystemSuspended: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  symbol: ResourceSymbol;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type PaymentMethodKind = "card" | "wallet" | "bank" | "store" | "other";

export type PaymentMethod = {
  id: string;
  name: string;
  kind: PaymentMethodKind;
  label: string | null;
  symbol: ResourceSymbol;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type RecurrenceUnit = "day" | "week" | "month" | "year";
export type AnchorMode = "calendar_day" | "end_of_month";

export type Recurrence = {
  unit: RecurrenceUnit;
  count: number;
  anchorOn: string;
  anchorMode: AnchorMode;
};

export type SubscriptionStatus = "active" | "cancelled";

export type Subscription = {
  id: string;
  name: string;
  symbol: ResourceSymbol;
  amount: string;
  currency: string;
  recurrence: Recurrence;
  nextBillingOn: string | null;
  status: SubscriptionStatus;
  cancelledAt: string | null;
  archivedAt: string | null;
  categoryId: string | null;
  paymentMethodId: string | null;
  websiteUrl: string | null;
  notes: string | null;
  emailReminderEnabled: boolean;
  emailReminderDaysBefore: number | null;
  createdAt: string;
  updatedAt: string;
};

export type RenewalEmailDeliverySummary = {
  state: "none" | "scheduled" | "paused" | "retrying" | "sent" | "failed" | "unknown" | "expired";
  occurrenceOn: string | null;
  lastAttemptAt: string | null;
};

export type SubscriptionDetail = Subscription & {
  emailReminderDelivery: RenewalEmailDeliverySummary;
};

export type UpcomingCharge = {
  subscriptionId: string;
  name: string;
  symbol: ResourceSymbol;
  amount: string;
  currency: string;
  billingOn: string;
  category: Pick<Category, "id" | "name" | "color" | "symbol"> | null;
};

export type CurrencyTotals = {
  currency: string;
  monthlyEstimate: string;
  annualizedEstimate: string;
  upcomingAmount: string;
  currentMonthCharges: string;
  currentYearCharges: string;
};

export type CategoryBreakdown = {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categorySymbol: ResourceSymbol;
  subscriptionCount: number;
  totalsByCurrency: Array<{
    currency: string;
    monthlyEstimate: string;
    annualizedEstimate: string;
  }>;
  reportingMonthlyAverage: string | null;
  reportingAnnualized: string | null;
};

export type PaymentMethodBreakdown = {
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentMethodKind: PaymentMethodKind | null;
  paymentMethodSymbol: ResourceSymbol;
  subscriptionCount: number;
  totalsByCurrency: Array<{
    currency: string;
    monthlyEstimate: string;
    annualizedEstimate: string;
  }>;
  reportingMonthlyAverage: string | null;
  reportingAnnualized: string | null;
};

export type ReportingEstimate = {
  amount: string;
  currency: string;
};

export type FxStatus = {
  state: "not_needed" | "fresh" | "stale" | "unavailable";
  provider: "ecb" | null;
  rateDate: string | null;
  fetchedAt: string | null;
  missingCurrencies: string[];
};

export type DashboardReporting = {
  currency: string;
  monthlyAverage: ReportingEstimate | null;
  annualized: ReportingEstimate | null;
  currentMonthCharges: ReportingEstimate | null;
  currentYearCharges: ReportingEstimate | null;
  fx: FxStatus;
};

export type Dashboard = {
  localToday: string;
  upcomingThrough: string;
  nextCharge: UpcomingCharge | null;
  reporting: DashboardReporting;
  totalsByCurrency: CurrencyTotals[];
  upcoming: UpcomingCharge[];
  categoryBreakdown: CategoryBreakdown[];
  paymentMethodBreakdown: PaymentMethodBreakdown[];
};

export type OpenSubListsArchiveV4 = {
  format: "opensublists";
  schemaVersion: 4;
  archiveId: string;
  exportedAt: string;
  generator: {
    name: "OpenSubLists";
    version: string;
  };
  profile: {
    displayName: string | null;
    timezone: string;
    reportingCurrency: string;
    interfaceLocale: "en" | "zh-Hans";
    emailLocale: "en" | "zh-Hans";
    defaultEmailReminderDaysBefore: number;
    emailReminderLocalTime: string;
    emailRemindersPaused: boolean;
  };
  categories: Category[];
  paymentMethods: PaymentMethod[];
  subscriptions: Array<Omit<Subscription, "nextBillingOn">>;
};

/** Offline locale-migration input only. The HTTP API accepts schema version 4 exclusively. */
export type OpenSubListsArchiveV3 = {
  format: "opensublists";
  schemaVersion: 3;
  archiveId: string;
  exportedAt: string;
  generator: {
    name: "OpenSubLists";
    version: string;
  };
  profile: {
    displayName: string | null;
    timezone: string;
    reportingCurrency: string;
    preferredLocale: "en" | "zh-Hans";
    defaultEmailReminderDaysBefore: number;
    emailReminderLocalTime: string;
    emailRemindersPaused: boolean;
  };
  categories: Category[];
  paymentMethods: PaymentMethod[];
  subscriptions: Array<Omit<Subscription, "nextBillingOn">>;
};

/** Offline migration input only. */
export type OpenSubListsArchiveV2 = {
  format: "opensublists";
  schemaVersion: 2;
  archiveId: string;
  exportedAt: string;
  generator: {
    name: "OpenSubLists";
    version: string;
  };
  profile: {
    displayName: string | null;
    timezone: string;
    reportingCurrency: string;
  };
  categories: Category[];
  paymentMethods: PaymentMethod[];
  subscriptions: Array<
    Omit<Subscription, "nextBillingOn" | "emailReminderEnabled" | "emailReminderDaysBefore">
  >;
};

export type ReminderImportImpact = {
  enabledPreferencesAfterApply: number;
  senderCapabilityAvailable: boolean;
  willForceGlobalPause: boolean;
};

export type ImportWarning = {
  path: string;
  code: string;
  message: string;
};

export type ImportPreview = {
  digest: string;
  schemaVersion: 4;
  counts: {
    categories: number;
    paymentMethods: number;
    subscriptions: number;
  };
  conflicts: {
    categories: number;
    paymentMethods: number;
    subscriptions: number;
  };
  warnings: ImportWarning[];
  reminderImpact: ReminderImportImpact;
};

export type ImportResult = {
  created: { categories: number; paymentMethods: number; subscriptions: number };
  updated: { categories: number; paymentMethods: number; subscriptions: number };
  skipped: { categories: number; paymentMethods: number; subscriptions: number };
  warnings: ImportWarning[];
  reminderImpact: ReminderImportImpact;
};

export type Session = {
  user: User;
  environment: "local" | "preview" | "production";
  capabilities: {
    emailReminders: boolean;
  };
};

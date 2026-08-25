import type {
  Category,
  PaymentMethod,
  Recurrence,
  ResourceSymbol,
  Subscription,
  User,
} from "../../shared/api-types";

export type {
  ApiErrorDetail,
  AnchorMode,
  Category,
  CategoryBreakdown,
  CommonIconKey,
  CurrencyTotals,
  Dashboard,
  DashboardReporting,
  FxStatus,
  ImportPreview,
  ImportResult,
  ImportWarning,
  OpenSubListsArchiveV4,
  PaymentMethod,
  PaymentMethodBreakdown,
  PaymentMethodKind,
  Recurrence,
  RecurrenceUnit,
  ReportingEstimate,
  ResourceSymbol,
  Session,
  Subscription,
  SubscriptionDetail,
  SubscriptionStatus,
  UpcomingCharge,
  User,
} from "../../shared/api-types";

export type UpdateUserInput = Partial<
  Pick<
    User,
    | "displayName"
    | "timezone"
    | "reportingCurrency"
    | "interfaceLocale"
    | "emailLocale"
    | "defaultEmailReminderDaysBefore"
    | "emailReminderLocalTime"
    | "emailRemindersPaused"
  >
>;

export type CategoryInput = Pick<Category, "name" | "color" | "symbol" | "position">;

export type PaymentMethodInput = Pick<
  PaymentMethod,
  "name" | "kind" | "label" | "symbol" | "position"
>;

export type SubscriptionInput = {
  name: string;
  amount: string;
  currency: string;
  recurrence: Recurrence;
  symbol?: ResourceSymbol;
  categoryId: Subscription["categoryId"];
  paymentMethodId: Subscription["paymentMethodId"];
  websiteUrl: Subscription["websiteUrl"];
  notes: Subscription["notes"];
  emailReminderEnabled: Subscription["emailReminderEnabled"];
  emailReminderDaysBefore: Subscription["emailReminderDaysBefore"];
};

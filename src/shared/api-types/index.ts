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
  defaultCurrency: string;
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  name: string;
  color: string;
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
  createdAt: string;
  updatedAt: string;
};

export type UpcomingCharge = {
  subscriptionId: string;
  name: string;
  amount: string;
  currency: string;
  billingOn: string;
  category: Pick<Category, "id" | "name" | "color"> | null;
};

export type CurrencyTotals = {
  currency: string;
  monthlyEstimate: string;
  annualizedEstimate: string;
  upcomingAmount: string;
};

export type CategoryBreakdown = {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  subscriptionCount: number;
  totalsByCurrency: Array<{
    currency: string;
    monthlyEstimate: string;
    annualizedEstimate: string;
  }>;
};

export type Dashboard = {
  localToday: string;
  upcomingThrough: string;
  nextCharge: UpcomingCharge | null;
  totalsByCurrency: CurrencyTotals[];
  upcoming: UpcomingCharge[];
  categoryBreakdown: CategoryBreakdown[];
};

export type OpenSubListsArchiveV1 = {
  format: "opensublists";
  schemaVersion: 1;
  archiveId: string;
  exportedAt: string;
  generator: {
    name: "OpenSubLists";
    version: string;
  };
  profile: {
    displayName: string | null;
    timezone: string;
    defaultCurrency: string;
  };
  categories: Category[];
  paymentMethods: PaymentMethod[];
  subscriptions: Array<Omit<Subscription, "nextBillingOn">>;
};

export type ImportWarning = {
  path: string;
  code: string;
  message: string;
};

export type ImportPreview = {
  digest: string;
  schemaVersion: 1;
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
};

export type ImportResult = {
  created: { categories: number; paymentMethods: number; subscriptions: number };
  updated: { categories: number; paymentMethods: number; subscriptions: number };
  skipped: { categories: number; paymentMethods: number; subscriptions: number };
  warnings: ImportWarning[];
};

export type Session = {
  user: User;
  environment: "local" | "preview" | "production";
};

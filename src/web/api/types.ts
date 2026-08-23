export type ApiErrorDetail = {
  path: string;
  code: string;
  message: string;
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

export type Session = {
  user: User;
  environment: "local" | "preview" | "production";
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

export type Recurrence = {
  unit: RecurrenceUnit;
  count: number;
  anchorOn: string;
  anchorMode: "calendar_day" | "end_of_month";
};

export type Subscription = {
  id: string;
  name: string;
  amount: string;
  currency: string;
  recurrence: Recurrence;
  nextBillingOn: string | null;
  status: "active" | "cancelled";
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

export type Dashboard = {
  localToday: string;
  upcomingThrough: string;
  nextCharge: UpcomingCharge | null;
  totalsByCurrency: Array<{
    currency: string;
    monthlyEstimate: string;
    annualizedEstimate: string;
    upcomingAmount: string;
  }>;
  upcoming: UpcomingCharge[];
  categoryBreakdown: Array<{
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    subscriptionCount: number;
    totalsByCurrency: Array<{
      currency: string;
      monthlyEstimate: string;
      annualizedEstimate: string;
    }>;
  }>;
};

export type SubscriptionInput = {
  name: string;
  amount: string;
  currency: string;
  recurrence: Recurrence;
  categoryId: string | null;
  paymentMethodId: string | null;
  websiteUrl: string | null;
  notes: string | null;
};

export type ImportPreview = {
  digest: string;
  schemaVersion: number;
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
  warnings: Array<{ path: string; code: string; message: string }>;
};

export type ImportResult = {
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  warnings: Array<{ path: string; code: string; message: string }>;
};

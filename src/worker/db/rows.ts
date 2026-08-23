import type {
  AppCategory,
  AppDashboardSubscription,
  AppPaymentMethod,
  AppSubscription,
  AppUser,
} from "../../application/models";
import type {
  AnchorMode,
  PaymentMethodKind,
  RecurrenceUnit,
  SubscriptionStatus,
} from "../../shared/api-types";

export type UserRow = {
  id: string;
  primary_email: string;
  email_normalized: string;
  display_name: string | null;
  timezone: string;
  default_currency: string;
  created_at: number;
  updated_at: number;
};

export type CategoryRow = {
  user_id: string;
  id: string;
  name: string;
  name_key: string;
  color: string;
  position: number;
  created_at: number;
  updated_at: number;
};

export type PaymentMethodRow = {
  user_id: string;
  id: string;
  name: string;
  kind: PaymentMethodKind;
  label: string | null;
  position: number;
  created_at: number;
  updated_at: number;
};

export type SubscriptionRow = {
  user_id: string;
  id: string;
  name: string;
  amount_micros: number;
  currency: string;
  recurrence_unit: RecurrenceUnit;
  recurrence_count: number;
  billing_anchor_on: string;
  anchor_mode: AnchorMode;
  next_billing_on: string | null;
  status: SubscriptionStatus;
  cancelled_at: number | null;
  archived_at: number | null;
  category_id: string | null;
  payment_method_id: string | null;
  website_url: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type DashboardSubscriptionRow = SubscriptionRow & {
  category_name: string | null;
  category_color: string | null;
  payment_method_name: string | null;
};

export function mapUserRow(row: UserRow): AppUser {
  return {
    id: row.id,
    primaryEmail: row.primary_email,
    displayName: row.display_name,
    timezone: row.timezone,
    defaultCurrency: row.default_currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCategoryRow(row: CategoryRow): AppCategory {
  return {
    id: row.id,
    name: row.name,
    nameKey: row.name_key,
    color: row.color,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPaymentMethodRow(row: PaymentMethodRow): AppPaymentMethod {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    label: row.label,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSubscriptionRow(row: SubscriptionRow): AppSubscription {
  return {
    id: row.id,
    name: row.name,
    amountMicros: row.amount_micros,
    currency: row.currency,
    recurrence: {
      unit: row.recurrence_unit,
      count: row.recurrence_count,
      anchorOn: row.billing_anchor_on,
      anchorMode: row.anchor_mode,
    },
    nextBillingOn: row.next_billing_on,
    status: row.status,
    cancelledAt: row.cancelled_at,
    archivedAt: row.archived_at,
    categoryId: row.category_id,
    paymentMethodId: row.payment_method_id,
    websiteUrl: row.website_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDashboardSubscriptionRow(
  row: DashboardSubscriptionRow,
): AppDashboardSubscription {
  return {
    ...mapSubscriptionRow(row),
    category:
      row.category_id === null || row.category_name === null || row.category_color === null
        ? null
        : { id: row.category_id, name: row.category_name, color: row.category_color },
    paymentMethod:
      row.payment_method_id === null || row.payment_method_name === null
        ? null
        : { id: row.payment_method_id, name: row.payment_method_name },
  };
}

import type {
  AppCategory,
  AppDashboardSubscription,
  AppPaymentMethod,
  AppRenewalEmailDelivery,
  AppSubscription,
  AppUser,
} from "../../application/models";
import {
  assertFxSnapshot,
  normalizeResourceSymbol,
  type FxSnapshot,
  type ResourceSymbol,
} from "../../domain";
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
  reporting_currency: string;
  onboarding_completed_at: number | null;
  created_at: number;
  updated_at: number;
  preferred_locale: "en" | "zh-Hans";
  default_email_reminder_days_before: number;
  email_reminder_local_time: string;
  email_reminders_paused: number;
  email_reminder_revision: number;
  email_reminder_suspension_reason: "identity_email_conflict" | null;
  email_reminder_suspension_email_normalized: string | null;
  resource_revision: number;
};

export type CategoryRow = {
  user_id: string;
  id: string;
  name: string;
  name_key: string;
  color: string;
  symbol_type: string | null;
  symbol_value: string | null;
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
  symbol_type: string | null;
  symbol_value: string | null;
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
  symbol_type: string | null;
  symbol_value: string | null;
  website_url: string | null;
  notes: string | null;
  email_reminder_enabled: number;
  email_reminder_days_before: number | null;
  email_reminder_revision: number;
  created_at: number;
  updated_at: number;
};

export type RenewalEmailDeliveryRow = {
  id: string;
  user_id: string;
  subscription_id: string;
  billing_on: string;
  effective_days_before: number;
  intended_send_at: number;
  expires_at: number;
  status: AppRenewalEmailDelivery["status"];
  attempt_count: number;
  claimed_at: number | null;
  lease_expires_at: number | null;
  next_attempt_at: number | null;
  sent_at: number | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  provider_key: string | null;
  provider_config_revision: number | null;
  application_idempotency_key: string | null;
  template_version: number | null;
  planned_user_reminder_revision: number;
  planned_subscription_reminder_revision: number;
  created_at: number;
  updated_at: number;
};

export type DashboardSubscriptionRow = SubscriptionRow & {
  category_name: string | null;
  category_color: string | null;
  category_symbol_type: string | null;
  category_symbol_value: string | null;
  payment_method_name: string | null;
  payment_method_kind: PaymentMethodKind | null;
  payment_method_symbol_type: string | null;
  payment_method_symbol_value: string | null;
};

export type FxSnapshotJoinRow = {
  snapshot_id: number;
  provider: string;
  rate_date: string;
  base_currency: string;
  fetched_at: number;
  rate_count: number;
  rate_currency: string | null;
  units_per_eur: string | null;
};

export function mapUserRow(row: UserRow): AppUser {
  return {
    id: row.id,
    primaryEmail: row.primary_email,
    displayName: row.display_name,
    timezone: row.timezone,
    reportingCurrency: row.reporting_currency,
    onboardingCompletedAt: row.onboarding_completed_at,
    preferredLocale: row.preferred_locale,
    defaultEmailReminderDaysBefore: row.default_email_reminder_days_before,
    emailReminderLocalTime: row.email_reminder_local_time,
    emailRemindersPaused: row.email_reminders_paused === 1,
    emailReminderRevision: row.email_reminder_revision,
    emailReminderSuspensionReason: row.email_reminder_suspension_reason,
    emailReminderSuspensionEmailNormalized: row.email_reminder_suspension_email_normalized,
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
    symbol: mapStoredResourceSymbol(row.symbol_type, row.symbol_value),
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
    symbol: mapStoredResourceSymbol(row.symbol_type, row.symbol_value),
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
    symbol: mapStoredResourceSymbol(row.symbol_type, row.symbol_value),
    websiteUrl: row.website_url,
    notes: row.notes,
    emailReminderEnabled: row.email_reminder_enabled === 1,
    emailReminderDaysBefore: row.email_reminder_days_before,
    emailReminderRevision: row.email_reminder_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRenewalEmailDeliveryRow(row: RenewalEmailDeliveryRow): AppRenewalEmailDelivery {
  return {
    id: row.id,
    userId: row.user_id,
    subscriptionId: row.subscription_id,
    billingOn: row.billing_on,
    effectiveDaysBefore: row.effective_days_before,
    intendedSendAt: row.intended_send_at,
    expiresAt: row.expires_at,
    status: row.status,
    attemptCount: row.attempt_count,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    nextAttemptAt: row.next_attempt_at,
    sentAt: row.sent_at,
    providerMessageId: row.provider_message_id,
    lastErrorCode: row.last_error_code,
    providerKey: row.provider_key,
    providerConfigRevision: row.provider_config_revision,
    applicationIdempotencyKey: row.application_idempotency_key,
    templateVersion: row.template_version,
    plannedUserReminderRevision: row.planned_user_reminder_revision,
    plannedSubscriptionReminderRevision: row.planned_subscription_reminder_revision,
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
        : {
            id: row.category_id,
            name: row.category_name,
            color: row.category_color,
            symbol: mapStoredResourceSymbol(row.category_symbol_type, row.category_symbol_value),
          },
    paymentMethod:
      row.payment_method_id === null || row.payment_method_name === null
        ? null
        : {
            id: row.payment_method_id,
            name: row.payment_method_name,
            kind: row.payment_method_kind ?? "other",
            symbol: mapStoredResourceSymbol(
              row.payment_method_symbol_type,
              row.payment_method_symbol_value,
            ),
          },
  };
}

export function mapFxSnapshotRows(rows: readonly FxSnapshotJoinRow[]): FxSnapshot | null {
  const first = rows[0];
  if (first === undefined) return null;

  const rates = rows.flatMap((row) => {
    if (row.rate_currency === null || row.units_per_eur === null) return [];
    return [{ currency: row.rate_currency, unitsPerEur: row.units_per_eur }];
  });
  if (rates.length !== first.rate_count) {
    throw new Error(
      `Exchange-rate snapshot expected ${first.rate_count} rates but stored ${rates.length}.`,
    );
  }

  return assertFxSnapshot({
    provider: first.provider as FxSnapshot["provider"],
    rateDate: first.rate_date,
    baseCurrency: first.base_currency as FxSnapshot["baseCurrency"],
    fetchedAt: first.fetched_at,
    rates,
  });
}

function mapStoredResourceSymbol(type: string | null, value: string | null): ResourceSymbol {
  if (type === null && value === null) return null;
  return normalizeResourceSymbol({ type, value });
}

import type { CreateCategoryInput, CreatePaymentMethodInput } from "../shared/api-types/schemas";
import type { FxSnapshot, ResourceSymbol } from "../domain";
import type {
  AppCategory,
  AppDashboardSubscription,
  AppPaymentMethod,
  AppRenewalEmailDelivery,
  AppSubscription,
  AppUser,
  AuthenticatedIdentity,
  ExistingImportState,
  ReminderDeliveryCandidate,
  ReminderPlanningCandidate,
  SubscriptionListFilter,
} from "./models";

export type CategoryWrite = CreateCategoryInput & {
  id: string;
  nameKey: string;
  symbol: ResourceSymbol;
  createdAt: number;
  updatedAt: number;
};

export type PaymentMethodWrite = CreatePaymentMethodInput & {
  id: string;
  symbol: ResourceSymbol;
  createdAt: number;
  updatedAt: number;
};

export type SubscriptionWrite = Omit<AppSubscription, "createdAt" | "updatedAt"> & {
  createdAt: number;
  updatedAt: number;
};

export type ImportMutation = {
  kind: "insert" | "overwrite";
  category?: CategoryWrite;
  paymentMethod?: PaymentMethodWrite;
  subscription?: SubscriptionWrite;
};

export type FxSnapshotReplaceResult = "replaced" | "unchanged";

export type ReminderDeliveryPlanWrite = {
  id: string;
  userId: string;
  subscriptionId: string;
  billingOn: string;
  effectiveDaysBefore: number;
  intendedSendAt: number;
  expiresAt: number;
  plannedUserReminderRevision: number;
  plannedSubscriptionReminderRevision: number;
  now: number;
};

export type ReminderProviderConfiguration = {
  providerKey: string;
  providerConfigRevision: number;
  templateVersion: number;
  appBaseUrl: string;
};

export type ReminderEmailEnvelope = {
  recipient: string;
  subject: string;
  text: string;
  html: string;
  applicationIdempotencyKey: string;
};

export type ReminderEmailSendOutcome =
  | { kind: "accepted"; providerMessageId: string | null }
  | { kind: "definitely_not_accepted_retryable"; errorCode: string }
  | { kind: "permanent"; errorCode: string }
  | { kind: "ambiguous"; errorCode: string };

export interface EmailSender {
  send(envelope: ReminderEmailEnvelope): Promise<ReminderEmailSendOutcome>;
}

export interface ReminderStore {
  maintainReminderDeliveries(now: number): Promise<void>;
  listReminderPlanningCandidates(): Promise<ReminderPlanningCandidate[]>;
  upsertReminderDeliveryPlan(value: ReminderDeliveryPlanWrite): Promise<boolean>;
  listDueReminderDeliveries(now: number, limit: number): Promise<ReminderDeliveryCandidate[]>;
  claimReminderDelivery(
    id: string,
    now: number,
    leaseExpiresAt: number,
    configuration: ReminderProviderConfiguration,
  ): Promise<ReminderDeliveryCandidate | null>;
  recordReminderDeliveryOutcome(
    id: string,
    attemptCount: number,
    outcome: ReminderEmailSendOutcome,
    now: number,
    nextAttemptAt: number | null,
  ): Promise<boolean>;
  listSubscriptionReminderDeliveries(
    userId: string,
    subscriptionId: string,
    limit: number,
  ): Promise<AppRenewalEmailDelivery[]>;
}

export type ImportApplyOutcome = {
  enabledPreferencesAfterApply: number;
  forcedGlobalPause: boolean;
};

export type ImportApplyGuard = {
  user: AppUser;
  resourceRevision: number;
};

export type ExportSnapshot = {
  user: AppUser | null;
  categories: AppCategory[];
  paymentMethods: AppPaymentMethod[];
  subscriptions: AppSubscription[];
};

export interface OpenSubListsRepository {
  resolveUser(identity: AuthenticatedIdentity, now: number): Promise<AppUser>;
  getUser(userId: string): Promise<AppUser | null>;
  updateUser(
    userId: string,
    patch: Partial<
      Pick<
        AppUser,
        | "displayName"
        | "timezone"
        | "reportingCurrency"
        | "preferredLocale"
        | "defaultEmailReminderDaysBefore"
        | "emailReminderLocalTime"
        | "emailRemindersPaused"
      >
    >,
    now: number,
  ): Promise<AppUser | null>;
  updateUserWithReconciliation(
    userId: string,
    patch: Partial<
      Pick<
        AppUser,
        | "displayName"
        | "timezone"
        | "reportingCurrency"
        | "preferredLocale"
        | "defaultEmailReminderDaysBefore"
        | "emailReminderLocalTime"
        | "emailRemindersPaused"
      >
    >,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
  ): Promise<AppUser | null>;
  clearEmailReminderIdentityConflict(
    userId: string,
    now: number,
  ): Promise<"cleared" | "not_found" | "not_suspended" | "still_conflicted">;
  completeOnboarding(userId: string, now: number): Promise<AppUser | null>;

  listCategories(userId: string): Promise<AppCategory[]>;
  getCategory(userId: string, id: string): Promise<AppCategory | null>;
  createCategory(userId: string, value: CategoryWrite): Promise<AppCategory | null>;
  createCategories(userId: string, values: CategoryWrite[]): Promise<AppCategory[] | null>;
  updateCategory(
    userId: string,
    id: string,
    patch: Partial<Pick<AppCategory, "name" | "nameKey" | "color" | "symbol" | "position">>,
    now: number,
  ): Promise<AppCategory | null>;
  deleteCategory(userId: string, id: string, now: number): Promise<boolean>;

  listPaymentMethods(userId: string): Promise<AppPaymentMethod[]>;
  getPaymentMethod(userId: string, id: string): Promise<AppPaymentMethod | null>;
  createPaymentMethod(userId: string, value: PaymentMethodWrite): Promise<AppPaymentMethod | null>;
  updatePaymentMethod(
    userId: string,
    id: string,
    patch: Partial<Pick<AppPaymentMethod, "name" | "kind" | "label" | "symbol" | "position">>,
    now: number,
  ): Promise<AppPaymentMethod | null>;
  deletePaymentMethod(userId: string, id: string, now: number): Promise<boolean>;

  listSubscriptions(userId: string, filter: SubscriptionListFilter): Promise<AppSubscription[]>;
  listAllSubscriptions(userId: string): Promise<AppSubscription[]>;
  listDashboardSubscriptions(userId: string): Promise<AppDashboardSubscription[]>;
  getSubscription(userId: string, id: string): Promise<AppSubscription | null>;
  createSubscription(userId: string, value: SubscriptionWrite): Promise<AppSubscription | null>;
  updateSubscription(
    userId: string,
    value: AppSubscription,
    expectedUpdatedAt: number,
    expectedEmailReminderRevision: number,
  ): Promise<AppSubscription | null>;
  deleteSubscription(userId: string, id: string): Promise<boolean>;
  reconcileSubscriptions(
    userId: string,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
  ): Promise<void>;

  readExportSnapshot(userId: string): Promise<ExportSnapshot>;

  getFxSnapshot(): Promise<FxSnapshot | null>;
  replaceFxSnapshot(snapshot: FxSnapshot): Promise<FxSnapshotReplaceResult>;

  getImportState(userId: string): Promise<ExistingImportState>;
  applyImport(
    userId: string,
    guard: ImportApplyGuard,
    mutations: ImportMutation[],
    profilePatch: Pick<
      AppUser,
      | "displayName"
      | "timezone"
      | "reportingCurrency"
      | "preferredLocale"
      | "defaultEmailReminderDaysBefore"
      | "emailReminderLocalTime"
      | "emailRemindersPaused"
    > | null,
    reconciliationUpdates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
    forcePauseWhenEnabled: boolean,
  ): Promise<ImportApplyOutcome>;
}

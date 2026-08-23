import type { CreateCategoryInput, CreatePaymentMethodInput } from "../shared/api-types/schemas";
import type {
  AppCategory,
  AppDashboardSubscription,
  AppPaymentMethod,
  AppSubscription,
  AppUser,
  AuthenticatedIdentity,
  ExistingImportState,
  SubscriptionListFilter,
} from "./models";

export type CategoryWrite = CreateCategoryInput & {
  id: string;
  nameKey: string;
  createdAt: number;
  updatedAt: number;
};

export type PaymentMethodWrite = CreatePaymentMethodInput & {
  id: string;
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

export interface OpenSubListsRepository {
  resolveUser(identity: AuthenticatedIdentity, now: number): Promise<AppUser>;
  getUser(userId: string): Promise<AppUser | null>;
  updateUser(
    userId: string,
    patch: Partial<Pick<AppUser, "displayName" | "timezone" | "defaultCurrency">>,
    now: number,
  ): Promise<AppUser | null>;
  updateUserWithReconciliation(
    userId: string,
    patch: Partial<Pick<AppUser, "displayName" | "timezone" | "defaultCurrency">>,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
  ): Promise<AppUser | null>;

  listCategories(userId: string): Promise<AppCategory[]>;
  getCategory(userId: string, id: string): Promise<AppCategory | null>;
  createCategory(userId: string, value: CategoryWrite): Promise<AppCategory | null>;
  updateCategory(
    userId: string,
    id: string,
    patch: Partial<Pick<AppCategory, "name" | "nameKey" | "color" | "position">>,
    now: number,
  ): Promise<AppCategory | null>;
  deleteCategory(userId: string, id: string): Promise<boolean>;

  listPaymentMethods(userId: string): Promise<AppPaymentMethod[]>;
  getPaymentMethod(userId: string, id: string): Promise<AppPaymentMethod | null>;
  createPaymentMethod(userId: string, value: PaymentMethodWrite): Promise<AppPaymentMethod | null>;
  updatePaymentMethod(
    userId: string,
    id: string,
    patch: Partial<Pick<AppPaymentMethod, "name" | "kind" | "label" | "position">>,
    now: number,
  ): Promise<AppPaymentMethod | null>;
  deletePaymentMethod(userId: string, id: string): Promise<boolean>;

  listSubscriptions(userId: string, filter: SubscriptionListFilter): Promise<AppSubscription[]>;
  listAllSubscriptions(userId: string): Promise<AppSubscription[]>;
  listDashboardSubscriptions(userId: string): Promise<AppDashboardSubscription[]>;
  getSubscription(userId: string, id: string): Promise<AppSubscription | null>;
  createSubscription(userId: string, value: SubscriptionWrite): Promise<AppSubscription | null>;
  updateSubscription(userId: string, value: AppSubscription): Promise<AppSubscription | null>;
  deleteSubscription(userId: string, id: string): Promise<boolean>;
  reconcileSubscriptions(
    userId: string,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
  ): Promise<void>;

  getImportState(userId: string): Promise<ExistingImportState>;
  applyImport(
    userId: string,
    mutations: ImportMutation[],
    profilePatch: Pick<AppUser, "displayName" | "timezone" | "defaultCurrency"> | null,
    reconciliationUpdates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
  ): Promise<void>;
}

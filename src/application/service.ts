import {
  assertCurrencyCode,
  assertIanaTimeZone,
  buildDashboardStatistics,
  calculateNextBillingOn,
  formatMicrosAsAmount,
  formatRationalMicrosAsAmount,
  localTodayInTimeZone,
  normalizeCategoryNameKey,
  parseAmountToMicros,
} from "../domain";
import type {
  Category,
  Dashboard,
  ImportPreview,
  ImportResult,
  OpenSubListsArchiveV1,
  PaymentMethod,
  Subscription,
  User,
} from "../shared/api-types";
import type {
  CreateCategoryInput,
  CreatePaymentMethodInput,
  CreateSubscriptionInput,
  ImportRequest,
  UpdateCategoryInput,
  UpdatePaymentMethodInput,
  UpdateSubscriptionInput,
  UpdateUserInput,
} from "../shared/api-types/schemas";
import type {
  AppCategory,
  AppPaymentMethod,
  AppSubscription,
  AppUser,
  AuthenticatedIdentity,
  ExistingImportState,
  SubscriptionListFilter,
} from "./models";
import type { ImportMutation, OpenSubListsRepository } from "./ports";
import { ApplicationError, conflict, notFound } from "./errors";

const ARCHIVE_KEYS = new Set([
  "format",
  "schemaVersion",
  "archiveId",
  "exportedAt",
  "generator",
  "profile",
  "categories",
  "paymentMethods",
  "subscriptions",
]);

const RESOURCE_LIMITS = {
  categories: 100,
  paymentMethods: 100,
  subscriptions: 50,
} as const;

export class OpenSubListsService {
  constructor(
    private readonly repository: OpenSubListsRepository,
    private readonly now: () => number = Date.now,
  ) {}

  resolveUser(identity: AuthenticatedIdentity): Promise<AppUser> {
    return this.repository.resolveUser(identity, this.now());
  }

  async getMe(userId: string): Promise<User> {
    return toApiUser(await this.requireUser(userId));
  }

  async updateMe(userId: string, input: UpdateUserInput): Promise<User> {
    if (input.defaultCurrency !== undefined) assertCurrencyCode(input.defaultCurrency);
    if (input.timezone !== undefined) assertIanaTimeZone(input.timezone);
    const before = await this.requireUser(userId);
    const now = this.now();
    const patch: Partial<Pick<AppUser, "displayName" | "timezone" | "defaultCurrency">> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.defaultCurrency !== undefined) patch.defaultCurrency = input.defaultCurrency;
    let updated: AppUser | null;
    if (input.timezone !== undefined && input.timezone !== before.timezone) {
      updated = await this.repository.updateUserWithReconciliation(
        userId,
        patch,
        buildReconciliationUpdates(
          await this.repository.listAllSubscriptions(userId),
          input.timezone,
          now,
        ),
        now,
      );
    } else {
      updated = await this.repository.updateUser(userId, patch, now);
    }
    if (updated === null) throw notFound("User");
    return toApiUser(updated);
  }

  async listCategories(userId: string): Promise<Category[]> {
    return (await this.repository.listCategories(userId)).map(toApiCategory);
  }

  async createCategory(userId: string, input: CreateCategoryInput): Promise<Category> {
    const now = this.now();
    try {
      const category = await this.repository.createCategory(userId, {
        ...input,
        id: crypto.randomUUID(),
        nameKey: normalizeCategoryNameKey(input.name),
        createdAt: now,
        updatedAt: now,
      });
      if (category === null) {
        throw conflict(`Category limit of ${RESOURCE_LIMITS.categories} reached.`);
      }
      return toApiCategory(category);
    } catch (error) {
      const resourceLimitError = mapResourceLimitError(error);
      if (resourceLimitError !== null) throw resourceLimitError;
      throw mapConstraintError(error, "A category with this name already exists.");
    }
  }

  async updateCategory(userId: string, id: string, input: UpdateCategoryInput): Promise<Category> {
    const patch: Partial<Pick<AppCategory, "name" | "nameKey" | "color" | "position">> = {};
    if (input.name !== undefined) {
      patch.name = input.name;
      patch.nameKey = normalizeCategoryNameKey(input.name);
    }
    if (input.color !== undefined) patch.color = input.color;
    if (input.position !== undefined) patch.position = input.position;
    try {
      const category = await this.repository.updateCategory(userId, id, patch, this.now());
      if (category === null) throw notFound("Category");
      return toApiCategory(category);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw mapConstraintError(error, "A category with this name already exists.");
    }
  }

  async deleteCategory(userId: string, id: string): Promise<void> {
    if (!(await this.repository.deleteCategory(userId, id))) throw notFound("Category");
  }

  async listPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    return (await this.repository.listPaymentMethods(userId)).map(toApiPaymentMethod);
  }

  async createPaymentMethod(
    userId: string,
    input: CreatePaymentMethodInput,
  ): Promise<PaymentMethod> {
    const now = this.now();
    try {
      const paymentMethod = await this.repository.createPaymentMethod(userId, {
        ...input,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      if (paymentMethod === null) {
        throw conflict(`Payment method limit of ${RESOURCE_LIMITS.paymentMethods} reached.`);
      }
      return toApiPaymentMethod(paymentMethod);
    } catch (error) {
      const resourceLimitError = mapResourceLimitError(error);
      if (resourceLimitError !== null) throw resourceLimitError;
      throw error;
    }
  }

  async updatePaymentMethod(
    userId: string,
    id: string,
    input: UpdatePaymentMethodInput,
  ): Promise<PaymentMethod> {
    const patch: Partial<Pick<AppPaymentMethod, "name" | "kind" | "label" | "position">> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.label !== undefined) patch.label = input.label;
    if (input.position !== undefined) patch.position = input.position;
    const paymentMethod = await this.repository.updatePaymentMethod(userId, id, patch, this.now());
    if (paymentMethod === null) throw notFound("Payment method");
    return toApiPaymentMethod(paymentMethod);
  }

  async deletePaymentMethod(userId: string, id: string): Promise<void> {
    if (!(await this.repository.deletePaymentMethod(userId, id))) throw notFound("Payment method");
  }

  async listSubscriptions(userId: string, filter: SubscriptionListFilter): Promise<Subscription[]> {
    const user = await this.requireUser(userId);
    const subscriptions = await this.repository.listSubscriptions(userId, filter);
    return (await this.reconcileRows(userId, subscriptions, user.timezone)).map(toApiSubscription);
  }

  async getSubscription(userId: string, id: string): Promise<Subscription> {
    const user = await this.requireUser(userId);
    const subscription = await this.repository.getSubscription(userId, id);
    if (subscription === null) throw notFound("Subscription");
    const [reconciled] = await this.reconcileRows(userId, [subscription], user.timezone);
    if (reconciled === undefined) throw notFound("Subscription");
    return toApiSubscription(reconciled);
  }

  async createSubscription(userId: string, input: CreateSubscriptionInput): Promise<Subscription> {
    const user = await this.requireUser(userId);
    await this.validateRelationships(userId, input.categoryId, input.paymentMethodId);
    const now = this.now();
    const amountMicros = parseAmountToMicros(input.amount);
    const currency = assertCurrencyCode(input.currency);
    const nextBillingOn = calculateNextBillingOn(
      input.recurrence,
      localTodayInTimeZone(user.timezone, now),
      "active",
    );
    if (nextBillingOn === null)
      throw new Error("Active recurrence did not produce a billing date.");
    try {
      const subscription = await this.repository.createSubscription(userId, {
        id: crypto.randomUUID(),
        name: input.name,
        amountMicros,
        currency,
        recurrence: input.recurrence,
        nextBillingOn,
        status: "active",
        cancelledAt: null,
        archivedAt: null,
        categoryId: input.categoryId,
        paymentMethodId: input.paymentMethodId,
        websiteUrl: input.websiteUrl,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      });
      if (subscription === null) {
        throw conflict(`Subscription limit of ${RESOURCE_LIMITS.subscriptions} reached.`);
      }
      return toApiSubscription(subscription);
    } catch (error) {
      const resourceLimitError = mapResourceLimitError(error);
      if (resourceLimitError !== null) throw resourceLimitError;
      throw error;
    }
  }

  async updateSubscription(
    userId: string,
    id: string,
    input: UpdateSubscriptionInput,
  ): Promise<Subscription> {
    const [current, user] = await Promise.all([
      this.repository.getSubscription(userId, id),
      this.requireUser(userId),
    ]);
    if (current === null) throw notFound("Subscription");
    const categoryId = input.categoryId === undefined ? current.categoryId : input.categoryId;
    const paymentMethodId =
      input.paymentMethodId === undefined ? current.paymentMethodId : input.paymentMethodId;
    await this.validateRelationships(userId, categoryId, paymentMethodId);
    const now = this.now();
    const recurrence = input.recurrence ?? current.recurrence;
    const nextBillingOn = calculateNextBillingOn(
      recurrence,
      localTodayInTimeZone(user.timezone, now),
      current.status,
    );
    const updated: AppSubscription = {
      ...current,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.amount === undefined ? {} : { amountMicros: parseAmountToMicros(input.amount) }),
      ...(input.currency === undefined ? {} : { currency: assertCurrencyCode(input.currency) }),
      ...(input.recurrence === undefined ? {} : { recurrence: input.recurrence }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.paymentMethodId === undefined ? {} : { paymentMethodId: input.paymentMethodId }),
      ...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      nextBillingOn,
      updatedAt: now,
    };
    const saved = await this.repository.updateSubscription(userId, updated);
    if (saved === null) throw notFound("Subscription");
    return toApiSubscription(saved);
  }

  async cancelSubscription(userId: string, id: string): Promise<Subscription> {
    return this.mutateSubscription(userId, id, (current, now) => ({
      ...current,
      status: "cancelled",
      cancelledAt: current.status === "cancelled" ? current.cancelledAt : now,
      nextBillingOn: null,
      updatedAt: current.status === "cancelled" ? current.updatedAt : now,
    }));
  }

  async reactivateSubscription(userId: string, id: string): Promise<Subscription> {
    const user = await this.requireUser(userId);
    return this.mutateSubscription(userId, id, (current, now) => ({
      ...current,
      status: "active",
      cancelledAt: null,
      nextBillingOn: calculateNextBillingOn(
        current.recurrence,
        localTodayInTimeZone(user.timezone, now),
        "active",
      ),
      updatedAt: current.status === "active" ? current.updatedAt : now,
    }));
  }

  async archiveSubscription(userId: string, id: string): Promise<Subscription> {
    return this.mutateSubscription(userId, id, (current, now) => ({
      ...current,
      archivedAt: current.archivedAt ?? now,
      updatedAt: current.archivedAt === null ? now : current.updatedAt,
    }));
  }

  async unarchiveSubscription(userId: string, id: string): Promise<Subscription> {
    const user = await this.requireUser(userId);
    return this.mutateSubscription(userId, id, (current, now) => ({
      ...current,
      archivedAt: null,
      nextBillingOn:
        current.status === "active"
          ? calculateNextBillingOn(
              current.recurrence,
              localTodayInTimeZone(user.timezone, now),
              "active",
            )
          : null,
      updatedAt: current.archivedAt === null ? current.updatedAt : now,
    }));
  }

  async deleteSubscription(userId: string, id: string): Promise<void> {
    if (!(await this.repository.deleteSubscription(userId, id))) throw notFound("Subscription");
  }

  async getDashboard(userId: string, upcomingDays: number): Promise<Dashboard> {
    const [user, rows] = await Promise.all([
      this.requireUser(userId),
      this.repository.listDashboardSubscriptions(userId),
    ]);
    const now = this.now();
    const localToday = localTodayInTimeZone(user.timezone, now);
    const stale = rows
      .filter(
        (row) =>
          row.status === "active" && row.nextBillingOn !== null && row.nextBillingOn < localToday,
      )
      .map((row) => ({
        id: row.id,
        nextBillingOn: calculateNextBillingOn(row.recurrence, localToday, "active") as string,
        updatedAt: now,
      }));
    await this.repository.reconcileSubscriptions(userId, stale);

    const statistics = buildDashboardStatistics(rows, localToday, upcomingDays);
    return {
      localToday: statistics.localToday,
      upcomingThrough: statistics.upcomingThrough,
      nextCharge:
        statistics.nextCharge === null
          ? null
          : {
              subscriptionId: statistics.nextCharge.subscriptionId,
              name: statistics.nextCharge.name,
              amount: formatMicrosAsAmount(statistics.nextCharge.amountMicros),
              currency: statistics.nextCharge.currency,
              billingOn: statistics.nextCharge.billingOn,
              category: statistics.nextCharge.category,
            },
      totalsByCurrency: statistics.totalsByCurrency.map((total) => ({
        currency: total.currency,
        monthlyEstimate: formatRationalMicrosAsAmount(total.monthlyEstimateMicros),
        annualizedEstimate: formatRationalMicrosAsAmount(total.annualizedEstimateMicros),
        upcomingAmount: formatMicrosAsAmount(total.upcomingAmountMicros),
      })),
      upcoming: statistics.upcoming.map((occurrence) => ({
        subscriptionId: occurrence.subscriptionId,
        name: occurrence.name,
        amount: formatMicrosAsAmount(occurrence.amountMicros),
        currency: occurrence.currency,
        billingOn: occurrence.billingOn,
        category: occurrence.category,
      })),
      categoryBreakdown: statistics.categoryBreakdown.map((breakdown) => ({
        categoryId: breakdown.id,
        categoryName: breakdown.name,
        categoryColor: breakdown.color,
        subscriptionCount: breakdown.subscriptionCount,
        totalsByCurrency: breakdown.totalsByCurrency.map((total) => ({
          currency: total.currency,
          monthlyEstimate: formatRationalMicrosAsAmount(total.monthlyEstimateMicros),
          annualizedEstimate: formatRationalMicrosAsAmount(total.annualizedEstimateMicros),
        })),
      })),
    };
  }

  async exportArchive(userId: string): Promise<OpenSubListsArchiveV1> {
    const [user, categories, paymentMethods, subscriptions] = await Promise.all([
      this.requireUser(userId),
      this.repository.listCategories(userId),
      this.repository.listPaymentMethods(userId),
      this.repository.listAllSubscriptions(userId),
    ]);
    return {
      format: "opensublists",
      schemaVersion: 1,
      archiveId: crypto.randomUUID(),
      exportedAt: new Date(this.now()).toISOString(),
      generator: { name: "OpenSubLists", version: "0.1.0" },
      profile: {
        displayName: user.displayName,
        timezone: user.timezone,
        defaultCurrency: user.defaultCurrency,
      },
      categories: categories.sort(comparePositionAndId).map(toApiCategory),
      paymentMethods: paymentMethods.sort(comparePositionAndId).map(toApiPaymentMethod),
      subscriptions: subscriptions
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(toArchiveSubscription),
    };
  }

  async previewImport(userId: string, source: Record<string, unknown>): Promise<ImportPreview> {
    const archive = canonicalArchive(source);
    const warnings = unknownTopLevelWarnings(source);
    validateArchiveRelationships(archive);
    const state = await this.repository.getImportState(userId);
    validateCategoryNameConflicts(archive, state, "skip");
    return {
      digest: await archiveDigest(archive),
      schemaVersion: 1,
      counts: {
        categories: archive.categories.length,
        paymentMethods: archive.paymentMethods.length,
        subscriptions: archive.subscriptions.length,
      },
      conflicts: {
        categories: countConflicts(archive.categories, state.categoryIds),
        paymentMethods: countConflicts(archive.paymentMethods, state.paymentMethodIds),
        subscriptions: countConflicts(archive.subscriptions, state.subscriptionIds),
      },
      warnings,
    };
  }

  async importArchive(userId: string, request: ImportRequest): Promise<ImportResult> {
    const archive = canonicalArchive(request.archive);
    validateArchiveRelationships(archive);
    if ((await archiveDigest(archive)) !== request.expectedDigest) {
      throw new ApplicationError(
        "IMPORT_DIGEST_MISMATCH",
        "The archive no longer matches the previewed file.",
        409,
      );
    }
    const [state, user] = await Promise.all([
      this.repository.getImportState(userId),
      this.requireUser(userId),
    ]);
    validateImportCapacity(archive, state, request.conflictStrategy);
    validateCategoryNameConflicts(archive, state, request.conflictStrategy);
    const now = this.now();
    const result = emptyImportResult(unknownTopLevelWarnings(request.archive));
    const duplicateIds = createDuplicateIdMaps(archive, request.conflictStrategy);
    const targetTimeZone = request.importProfile ? archive.profile.timezone : user.timezone;
    const localToday = localTodayInTimeZone(targetTimeZone, now);
    const reconciliationUpdates =
      request.importProfile && targetTimeZone !== user.timezone
        ? buildReconciliationUpdates(
            await this.repository.listAllSubscriptions(userId),
            targetTimeZone,
            now,
          )
        : [];
    const mutations: ImportMutation[] = [];

    for (const category of archive.categories) {
      const exists = state.categoryIds.has(category.id);
      if (exists && request.conflictStrategy === "skip") {
        result.skipped.categories += 1;
        continue;
      }
      const id = duplicateIds.categories.get(category.id) ?? category.id;
      mutations.push({
        kind: exists && request.conflictStrategy === "overwrite" ? "overwrite" : "insert",
        category: {
          id,
          name: category.name,
          nameKey: normalizeCategoryNameKey(category.name),
          color: category.color,
          position: category.position,
          createdAt: Date.parse(category.createdAt),
          updatedAt: Date.parse(category.updatedAt),
        },
      });
      incrementMutationResult(result, "categories", exists, request.conflictStrategy);
    }

    for (const paymentMethod of archive.paymentMethods) {
      const exists = state.paymentMethodIds.has(paymentMethod.id);
      if (exists && request.conflictStrategy === "skip") {
        result.skipped.paymentMethods += 1;
        continue;
      }
      mutations.push({
        kind: exists && request.conflictStrategy === "overwrite" ? "overwrite" : "insert",
        paymentMethod: {
          ...paymentMethod,
          id: duplicateIds.paymentMethods.get(paymentMethod.id) ?? paymentMethod.id,
          createdAt: Date.parse(paymentMethod.createdAt),
          updatedAt: Date.parse(paymentMethod.updatedAt),
        },
      });
      incrementMutationResult(result, "paymentMethods", exists, request.conflictStrategy);
    }

    for (const subscription of archive.subscriptions) {
      const exists = state.subscriptionIds.has(subscription.id);
      if (exists && request.conflictStrategy === "skip") {
        result.skipped.subscriptions += 1;
        continue;
      }
      const recurrence = subscription.recurrence;
      mutations.push({
        kind: exists && request.conflictStrategy === "overwrite" ? "overwrite" : "insert",
        subscription: {
          id: duplicateIds.subscriptions.get(subscription.id) ?? subscription.id,
          name: subscription.name,
          amountMicros: parseAmountToMicros(subscription.amount),
          currency: assertCurrencyCode(subscription.currency),
          recurrence,
          nextBillingOn: calculateNextBillingOn(recurrence, localToday, subscription.status),
          status: subscription.status,
          cancelledAt:
            subscription.cancelledAt === null ? null : Date.parse(subscription.cancelledAt),
          archivedAt: subscription.archivedAt === null ? null : Date.parse(subscription.archivedAt),
          categoryId:
            subscription.categoryId === null
              ? null
              : (duplicateIds.categories.get(subscription.categoryId) ?? subscription.categoryId),
          paymentMethodId:
            subscription.paymentMethodId === null
              ? null
              : (duplicateIds.paymentMethods.get(subscription.paymentMethodId) ??
                subscription.paymentMethodId),
          websiteUrl: subscription.websiteUrl,
          notes: subscription.notes,
          createdAt: Date.parse(subscription.createdAt),
          updatedAt: Date.parse(subscription.updatedAt),
        },
      });
      incrementMutationResult(result, "subscriptions", exists, request.conflictStrategy);
    }

    try {
      await this.repository.applyImport(
        userId,
        mutations,
        request.importProfile
          ? {
              displayName: archive.profile.displayName,
              timezone: archive.profile.timezone,
              defaultCurrency: assertCurrencyCode(archive.profile.defaultCurrency),
            }
          : null,
        reconciliationUpdates,
        now,
      );
    } catch (error) {
      const resourceLimitError = mapResourceLimitError(error);
      if (resourceLimitError !== null) throw resourceLimitError;
      throw error;
    }
    return result;
  }

  private async requireUser(userId: string): Promise<AppUser> {
    const user = await this.repository.getUser(userId);
    if (user === null) throw notFound("User");
    return user;
  }

  private async validateRelationships(
    userId: string,
    categoryId: string | null,
    paymentMethodId: string | null,
  ): Promise<void> {
    const [category, paymentMethod] = await Promise.all([
      categoryId === null ? null : this.repository.getCategory(userId, categoryId),
      paymentMethodId === null ? null : this.repository.getPaymentMethod(userId, paymentMethodId),
    ]);
    const details = [];
    if (categoryId !== null && category === null) {
      details.push({
        path: "categoryId",
        code: "INVALID_REFERENCE",
        message: "Category was not found.",
      });
    }
    if (paymentMethodId !== null && paymentMethod === null) {
      details.push({
        path: "paymentMethodId",
        code: "INVALID_REFERENCE",
        message: "Payment method was not found.",
      });
    }
    if (details.length > 0) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "The request contains invalid fields.",
        422,
        details,
      );
    }
  }

  private async mutateSubscription(
    userId: string,
    id: string,
    mutate: (value: AppSubscription, now: number) => AppSubscription,
  ): Promise<Subscription> {
    const current = await this.repository.getSubscription(userId, id);
    if (current === null) throw notFound("Subscription");
    const next = mutate(current, this.now());
    const updated = await this.repository.updateSubscription(userId, next);
    if (updated === null) throw notFound("Subscription");
    return toApiSubscription(updated);
  }

  private async reconcileRows(
    userId: string,
    rows: AppSubscription[],
    timezone: string,
    force = false,
  ): Promise<AppSubscription[]> {
    const now = this.now();
    const localToday = localTodayInTimeZone(timezone, now);
    const updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }> = [];
    const reconciled = rows.map((row) => {
      if (
        row.status !== "active" ||
        (!force && row.nextBillingOn !== null && row.nextBillingOn >= localToday)
      ) {
        return row;
      }
      const nextBillingOn = calculateNextBillingOn(row.recurrence, localToday, "active");
      if (nextBillingOn === null) return row;
      updates.push({ id: row.id, nextBillingOn, updatedAt: now });
      return { ...row, nextBillingOn, updatedAt: now };
    });
    await this.repository.reconcileSubscriptions(userId, updates);
    return reconciled;
  }
}

export function toApiUser(value: AppUser): User {
  return {
    id: value.id,
    email: value.primaryEmail,
    displayName: value.displayName,
    timezone: value.timezone,
    defaultCurrency: value.defaultCurrency,
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

function toApiCategory(value: AppCategory): Category {
  return {
    id: value.id,
    name: value.name,
    color: value.color,
    position: value.position,
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

function toApiPaymentMethod(value: AppPaymentMethod): PaymentMethod {
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    label: value.label,
    position: value.position,
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

function toApiSubscription(
  value: Omit<AppSubscription, "nextBillingOn"> & { nextBillingOn?: string | null },
): Subscription {
  return {
    id: value.id,
    name: value.name,
    amount: formatMicrosAsAmount(value.amountMicros),
    currency: value.currency,
    recurrence: value.recurrence,
    nextBillingOn: value.nextBillingOn ?? null,
    status: value.status,
    cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt).toISOString(),
    archivedAt: value.archivedAt === null ? null : new Date(value.archivedAt).toISOString(),
    categoryId: value.categoryId,
    paymentMethodId: value.paymentMethodId,
    websiteUrl: value.websiteUrl,
    notes: value.notes,
    createdAt: new Date(value.createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

function toArchiveSubscription(value: AppSubscription): Omit<Subscription, "nextBillingOn"> {
  const subscription = toApiSubscription(value);
  return {
    id: subscription.id,
    name: subscription.name,
    amount: subscription.amount,
    currency: subscription.currency,
    recurrence: subscription.recurrence,
    status: subscription.status,
    cancelledAt: subscription.cancelledAt,
    archivedAt: subscription.archivedAt,
    categoryId: subscription.categoryId,
    paymentMethodId: subscription.paymentMethodId,
    websiteUrl: subscription.websiteUrl,
    notes: subscription.notes,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

function mapConstraintError(error: unknown, message: string): Error {
  if (error instanceof Error && /UNIQUE constraint failed|constraint failed/i.test(error.message)) {
    return conflict(message);
  }
  return error instanceof Error ? error : new Error("Unknown persistence failure.");
}

function comparePositionAndId<T extends { position: number; id: string }>(
  left: T,
  right: T,
): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function canonicalArchive(source: Record<string, unknown>): OpenSubListsArchiveV1 {
  const archive = source as OpenSubListsArchiveV1;
  return {
    format: "opensublists",
    schemaVersion: 1,
    archiveId: archive.archiveId,
    exportedAt: new Date(archive.exportedAt).toISOString(),
    generator: { name: "OpenSubLists", version: archive.generator.version },
    profile: {
      displayName: archive.profile.displayName,
      timezone: assertIanaTimeZone(archive.profile.timezone),
      defaultCurrency: assertCurrencyCode(archive.profile.defaultCurrency),
    },
    categories: archive.categories.map((category) => ({ ...category })),
    paymentMethods: archive.paymentMethods.map((method) => ({ ...method })),
    subscriptions: archive.subscriptions.map((subscription) => ({
      ...subscription,
      amount: formatMicrosAsAmount(parseAmountToMicros(subscription.amount)),
      currency: assertCurrencyCode(subscription.currency),
    })),
  };
}

function buildReconciliationUpdates(
  subscriptions: AppSubscription[],
  timezone: string,
  now: number,
): Array<{ id: string; nextBillingOn: string; updatedAt: number }> {
  const localToday = localTodayInTimeZone(timezone, now);
  return subscriptions.flatMap((subscription) => {
    if (subscription.status !== "active") return [];
    const nextBillingOn = calculateNextBillingOn(subscription.recurrence, localToday, "active");
    return nextBillingOn === null ? [] : [{ id: subscription.id, nextBillingOn, updatedAt: now }];
  });
}

function validateImportCapacity(
  archive: OpenSubListsArchiveV1,
  state: ExistingImportState,
  strategy: "skip" | "overwrite" | "duplicate",
): void {
  const insertedCount = <T extends { id: string }>(items: T[], existingIds: Set<string>): number =>
    strategy === "duplicate"
      ? items.length
      : items.reduce((count, item) => count + (existingIds.has(item.id) ? 0 : 1), 0);

  const assertCapacity = <T extends { id: string }>(
    resource: keyof typeof RESOURCE_LIMITS,
    items: T[],
    existingIds: Set<string>,
  ): void => {
    if (existingIds.size + insertedCount(items, existingIds) > RESOURCE_LIMITS[resource]) {
      throw conflict(
        `${resourceLimitLabel(resource)} limit of ${RESOURCE_LIMITS[resource]} reached.`,
      );
    }
  };

  assertCapacity("categories", archive.categories, state.categoryIds);
  assertCapacity("paymentMethods", archive.paymentMethods, state.paymentMethodIds);
  assertCapacity("subscriptions", archive.subscriptions, state.subscriptionIds);
}

function resourceLimitLabel(resource: keyof typeof RESOURCE_LIMITS): string {
  if (resource === "paymentMethods") return "Payment method";
  return resource === "categories" ? "Category" : "Subscription";
}

function mapResourceLimitError(error: unknown): ApplicationError | null {
  const message = error instanceof Error ? error.message : String(error);
  for (const [marker, resource] of [
    ["RESOURCE_LIMIT_CATEGORIES", "categories"],
    ["RESOURCE_LIMIT_PAYMENT_METHODS", "paymentMethods"],
    ["RESOURCE_LIMIT_SUBSCRIPTIONS", "subscriptions"],
  ] as const) {
    if (message.includes(marker)) {
      return conflict(
        `${resourceLimitLabel(resource)} limit of ${RESOURCE_LIMITS[resource]} reached.`,
      );
    }
  }
  return null;
}

function validateArchiveRelationships(archive: OpenSubListsArchiveV1): void {
  const categoryIds = assertUniqueIds(archive.categories, "categories");
  const paymentMethodIds = assertUniqueIds(archive.paymentMethods, "paymentMethods");
  assertUniqueIds(archive.subscriptions, "subscriptions");
  const categoryNameKeys = new Set<string>();
  for (const [index, category] of archive.categories.entries()) {
    const key = normalizeCategoryNameKey(category.name);
    if (categoryNameKeys.has(key)) {
      throw importValidation(`categories[${index}].name`, "DUPLICATE_CATEGORY_NAME");
    }
    categoryNameKeys.add(key);
  }
  for (const [index, subscription] of archive.subscriptions.entries()) {
    if (subscription.categoryId !== null && !categoryIds.has(subscription.categoryId)) {
      throw importValidation(`subscriptions[${index}].categoryId`, "BROKEN_REFERENCE");
    }
    if (
      subscription.paymentMethodId !== null &&
      !paymentMethodIds.has(subscription.paymentMethodId)
    ) {
      throw importValidation(`subscriptions[${index}].paymentMethodId`, "BROKEN_REFERENCE");
    }
    if (
      (subscription.status === "active" && subscription.cancelledAt !== null) ||
      (subscription.status === "cancelled" && subscription.cancelledAt === null)
    ) {
      throw importValidation(`subscriptions[${index}].cancelledAt`, "INVALID_LIFECYCLE");
    }
  }
}

function assertUniqueIds<T extends { id: string }>(items: T[], path: string): Set<string> {
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.id)) throw importValidation(`${path}[${index}].id`, "DUPLICATE_ID");
    ids.add(item.id);
  }
  return ids;
}

function importValidation(path: string, code: string): ApplicationError {
  return new ApplicationError("VALIDATION_ERROR", "The archive contains invalid data.", 422, [
    { path, code, message: "The archive value is not valid." },
  ]);
}

function validateCategoryNameConflicts(
  archive: OpenSubListsArchiveV1,
  state: ExistingImportState,
  strategy: "skip" | "overwrite" | "duplicate",
): void {
  for (const [index, category] of archive.categories.entries()) {
    const incomingKey = normalizeCategoryNameKey(category.name);
    for (const [existingId, existingKey] of state.categoryNameKeysById) {
      const sameOverwriteTarget = strategy !== "duplicate" && existingId === category.id;
      if (incomingKey === existingKey && !sameOverwriteTarget) {
        throw importValidation(`categories[${index}].name`, "CATEGORY_NAME_CONFLICT");
      }
    }
  }
}

function countConflicts<T extends { id: string }>(items: T[], ids: Set<string>): number {
  return items.reduce((count, item) => count + (ids.has(item.id) ? 1 : 0), 0);
}

function unknownTopLevelWarnings(source: Record<string, unknown>) {
  return Object.keys(source)
    .filter((key) => !ARCHIVE_KEYS.has(key))
    .sort()
    .map((key) => ({
      path: key,
      code: "UNSUPPORTED_SOURCE_FIELD",
      message: "This source field is not supported and will not be imported.",
    }));
}

async function archiveDigest(archive: OpenSubListsArchiveV1): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(archive));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256-${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function createDuplicateIdMaps(
  archive: OpenSubListsArchiveV1,
  strategy: "skip" | "overwrite" | "duplicate",
) {
  return {
    categories: new Map(
      strategy === "duplicate"
        ? archive.categories.map((item) => [item.id, crypto.randomUUID()] as const)
        : [],
    ),
    paymentMethods: new Map(
      strategy === "duplicate"
        ? archive.paymentMethods.map((item) => [item.id, crypto.randomUUID()] as const)
        : [],
    ),
    subscriptions: new Map(
      strategy === "duplicate"
        ? archive.subscriptions.map((item) => [item.id, crypto.randomUUID()] as const)
        : [],
    ),
  };
}

function emptyImportResult(warnings: ImportResult["warnings"]): ImportResult {
  return {
    created: { categories: 0, paymentMethods: 0, subscriptions: 0 },
    updated: { categories: 0, paymentMethods: 0, subscriptions: 0 },
    skipped: { categories: 0, paymentMethods: 0, subscriptions: 0 },
    warnings,
  };
}

function incrementMutationResult(
  result: ImportResult,
  resource: "categories" | "paymentMethods" | "subscriptions",
  exists: boolean,
  strategy: "skip" | "overwrite" | "duplicate",
): void {
  if (exists && strategy === "overwrite") result.updated[resource] += 1;
  else result.created[resource] += 1;
}

import type {
  AppCategory,
  AppPaymentMethod,
  AppRenewalEmailDelivery,
  AppSubscription,
  AppUser,
  AuthenticatedIdentity,
  ExistingImportState,
  ReminderDeliveryCandidate,
  ReminderPlanningCandidate,
  SubscriptionListFilter,
} from "../../application/models";
import {
  IdentityEmailConflictError,
  ImportStateChangedError,
  SubscriptionStateChangedError,
} from "../../application/errors";
import type {
  CategoryWrite,
  ExportSnapshot,
  FxSnapshotReplaceResult,
  ImportApplyGuard,
  ImportMutation,
  ImportApplyOutcome,
  OpenSubListsRepository,
  PaymentMethodWrite,
  SubscriptionWrite,
  ReminderDeliveryPlanWrite,
  ReminderEmailSendOutcome,
  ReminderProviderConfiguration,
  ReminderStore,
} from "../../application/ports";
import {
  assertFxSnapshot,
  canonicalizePositiveDecimal,
  normalizeEmailAddress,
  type FxSnapshot,
  type ResourceSymbol,
} from "../../domain";
import {
  mapCategoryRow,
  mapDashboardSubscriptionRow,
  mapFxSnapshotRows,
  mapPaymentMethodRow,
  mapSubscriptionRow,
  mapUserRow,
  mapRenewalEmailDeliveryRow,
  type CategoryRow,
  type DashboardSubscriptionRow,
  type FxSnapshotJoinRow,
  type PaymentMethodRow,
  type SubscriptionRow,
  type UserRow,
  type RenewalEmailDeliveryRow,
} from "./rows";

const SUBSCRIPTION_COLUMNS = `
  user_id, id, name, amount_micros, currency, recurrence_unit,
  recurrence_count, billing_anchor_on, anchor_mode, next_billing_on,
  status, cancelled_at, archived_at, category_id, payment_method_id,
  symbol_type, symbol_value, website_url, notes, created_at, updated_at,
  email_reminder_enabled, email_reminder_days_before, email_reminder_revision
`;

const CATEGORY_BATCH_LIMIT = 13;

type UserUpdatePatch = Parameters<OpenSubListsRepository["updateUser"]>[1];

export class D1OpenSubListsRepository implements OpenSubListsRepository, ReminderStore {
  constructor(private readonly db: D1Database) {}

  async resolveUser(identity: AuthenticatedIdentity, now: number): Promise<AppUser> {
    const emailNormalized = normalizeEmailAddress(identity.email);
    const existing = await this.findUserByIdentity(identity);

    if (existing !== null) {
      const emailOwner = await this.db
        .prepare("SELECT id FROM users WHERE email_normalized = ?")
        .bind(emailNormalized)
        .first<{ id: string }>();
      if (emailOwner !== null && emailOwner.id !== existing.id) {
        await this.suspendForIdentityEmailConflict(existing.id, emailNormalized, now);
        throw new IdentityEmailConflictError();
      }

      try {
        await this.db.batch([
          this.db
            .prepare(
              `UPDATE auth_identities
               SET email = ?, email_normalized = ?, last_seen_at = ?
               WHERE provider = ? AND subject = ?`,
            )
            .bind(identity.email, emailNormalized, now, identity.provider, identity.subject),
          this.db
            .prepare(
              `UPDATE users
               SET primary_email = ?,
                   email_normalized = ?,
                   email_reminder_revision = email_reminder_revision + CASE
                     WHEN primary_email <> ? OR email_normalized <> ? THEN 1 ELSE 0 END,
                   updated_at = CASE
                     WHEN primary_email <> ? OR email_normalized <> ? THEN ? ELSE updated_at END
               WHERE id = ?`,
            )
            .bind(
              identity.email,
              emailNormalized,
              identity.email,
              emailNormalized,
              identity.email,
              emailNormalized,
              now,
              existing.id,
            ),
          this.cancelDeliveriesForUserRevisionStatement(existing.id, now),
        ]);
      } catch (error) {
        if (!isConstraintFailure(error)) throw error;
        await this.suspendForIdentityEmailConflict(existing.id, emailNormalized, now);
        throw new IdentityEmailConflictError();
      }
      const resolved = await this.getUser(existing.id);
      if (resolved === null) throw new Error("Resolved user disappeared after identity refresh.");
      return resolved;
    }

    const userWithEmail = await this.db
      .prepare("SELECT * FROM users WHERE email_normalized = ?")
      .bind(emailNormalized)
      .first<UserRow>();

    if (userWithEmail !== null) {
      const relink = await this.db
        .prepare(
          `INSERT OR IGNORE INTO auth_identities (
             provider, subject, user_id, email, email_normalized, created_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          identity.provider,
          identity.subject,
          userWithEmail.id,
          identity.email,
          emailNormalized,
          now,
          now,
        )
        .run();
      const resolved = await this.findUserByIdentity(identity);
      if (resolved === null || resolved.id !== userWithEmail.id) {
        throw new IdentityEmailConflictError();
      }
      if (relink.meta.changes > 0) logIdentityRelink(userWithEmail.id, identity.provider);
      return mapUserRow(resolved);
    }

    const userId = crypto.randomUUID();
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO users (
               id, primary_email, email_normalized, display_name, timezone,
               reporting_currency, created_at, updated_at
             ) VALUES (?, ?, ?, NULL, 'UTC', 'USD', ?, ?)`,
          )
          .bind(userId, identity.email, emailNormalized, now, now),
        this.db
          .prepare(
            `INSERT INTO auth_identities (
               provider, subject, user_id, email, email_normalized, created_at, last_seen_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            identity.provider,
            identity.subject,
            userId,
            identity.email,
            emailNormalized,
            now,
            now,
          ),
      ]);
    } catch (error) {
      if (!isConstraintFailure(error)) throw error;
      const racedIdentity = await this.findUserByIdentity(identity);
      if (racedIdentity !== null) return mapUserRow(racedIdentity);
      const racedUser = await this.db
        .prepare("SELECT * FROM users WHERE email_normalized = ?")
        .bind(emailNormalized)
        .first<UserRow>();
      if (racedUser === null) throw error;
      const relink = await this.db
        .prepare(
          `INSERT OR IGNORE INTO auth_identities (
             provider, subject, user_id, email, email_normalized, created_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          identity.provider,
          identity.subject,
          racedUser.id,
          identity.email,
          emailNormalized,
          now,
          now,
        )
        .run();
      if (relink.meta.changes > 0) logIdentityRelink(racedUser.id, identity.provider);
      const resolved = await this.findUserByIdentity(identity);
      if (resolved === null) throw error;
      return mapUserRow(resolved);
    }

    return {
      id: userId,
      primaryEmail: identity.email,
      displayName: null,
      timezone: "UTC",
      reportingCurrency: "USD",
      onboardingCompletedAt: null,
      interfaceLocale: "en",
      emailLocale: "en",
      defaultEmailReminderDaysBefore: 7,
      emailReminderLocalTime: "09:00",
      emailRemindersPaused: false,
      emailReminderRevision: 0,
      emailReminderSuspensionReason: null,
      emailReminderSuspensionEmailNormalized: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async suspendForIdentityEmailConflict(
    userId: string,
    candidateEmailNormalized: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE users
         SET email_reminder_suspension_reason = 'identity_email_conflict',
             email_reminder_suspension_email_normalized = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(candidateEmailNormalized, now, userId)
      .run();
  }

  private findUserByIdentity(identity: AuthenticatedIdentity): Promise<UserRow | null> {
    return this.db
      .prepare(
        `SELECT u.*
         FROM auth_identities ai
         JOIN users u ON u.id = ai.user_id
         WHERE ai.provider = ? AND ai.subject = ?`,
      )
      .bind(identity.provider, identity.subject)
      .first<UserRow>();
  }

  async getUser(userId: string): Promise<AppUser | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first<UserRow>();
    return row === null ? null : mapUserRow(row);
  }

  async updateUser(userId: string, patch: UserUpdatePatch, now: number): Promise<AppUser | null> {
    await this.db.batch([
      this.userUpdateStatement(userId, patch, now),
      this.cancelDeliveriesForUserRevisionStatement(userId, now),
    ]);
    return this.getUser(userId);
  }

  async updateUserWithReconciliation(
    userId: string,
    patch: UserUpdatePatch,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
  ): Promise<AppUser | null> {
    const statements = [this.userUpdateStatement(userId, patch, now)];
    if (updates.length > 0) {
      statements.push(this.reconciliationStatement(userId, updates));
    }
    statements.push(this.cancelDeliveriesForUserRevisionStatement(userId, now));
    await this.db.batch(statements);
    return this.getUser(userId);
  }

  private userUpdateStatement(
    userId: string,
    patch: UserUpdatePatch,
    now: number,
  ): D1PreparedStatement {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const revisionConditions: string[] = [];
    const revisionValues: unknown[] = [];
    if ("displayName" in patch) {
      assignments.push("display_name = ?");
      values.push(patch.displayName ?? null);
    }
    if (patch.timezone !== undefined) {
      assignments.push("timezone = ?");
      values.push(patch.timezone);
      revisionConditions.push("timezone IS NOT ?");
      revisionValues.push(patch.timezone);
    }
    if (patch.reportingCurrency !== undefined) {
      assignments.push("reporting_currency = ?");
      values.push(patch.reportingCurrency);
    }
    if (patch.interfaceLocale !== undefined) {
      assignments.push("preferred_locale = ?");
      values.push(patch.interfaceLocale);
    }
    if (patch.emailLocale !== undefined) {
      assignments.push("email_locale = ?");
      values.push(patch.emailLocale);
      revisionConditions.push("email_locale IS NOT ?");
      revisionValues.push(patch.emailLocale);
    }
    if (patch.defaultEmailReminderDaysBefore !== undefined) {
      assignments.push("default_email_reminder_days_before = ?");
      values.push(patch.defaultEmailReminderDaysBefore);
      revisionConditions.push("default_email_reminder_days_before IS NOT ?");
      revisionValues.push(patch.defaultEmailReminderDaysBefore);
    }
    if (patch.emailReminderLocalTime !== undefined) {
      assignments.push("email_reminder_local_time = ?");
      values.push(patch.emailReminderLocalTime);
      revisionConditions.push("email_reminder_local_time IS NOT ?");
      revisionValues.push(patch.emailReminderLocalTime);
    }
    if (patch.emailRemindersPaused !== undefined) {
      assignments.push("email_reminders_paused = ?");
      values.push(patch.emailRemindersPaused ? 1 : 0);
    }
    if (revisionConditions.length > 0) {
      assignments.push(
        `email_reminder_revision = email_reminder_revision + CASE WHEN ${revisionConditions.join(
          " OR ",
        )} THEN 1 ELSE 0 END`,
      );
      values.push(...revisionValues);
    }
    assignments.push("updated_at = ?");
    values.push(now, userId);
    return this.db
      .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
      .bind(...values);
  }

  private cancelDeliveriesForUserRevisionStatement(
    userId: string,
    now: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE renewal_email_deliveries AS delivery
         SET status = 'cancelled', next_attempt_at = NULL,
             last_error_code = 'preference_or_revision_changed', updated_at = ?
         WHERE delivery.user_id = ?
           AND delivery.status IN ('pending', 'retry_wait')
           AND delivery.planned_user_reminder_revision <> (
             SELECT email_reminder_revision FROM users WHERE id = delivery.user_id
           )`,
      )
      .bind(now, userId);
  }

  async clearEmailReminderIdentityConflict(
    userId: string,
    now: number,
  ): Promise<"cleared" | "not_found" | "not_suspended" | "still_conflicted"> {
    const current = await this.db
      .prepare(
        `SELECT email_reminder_suspension_reason AS reason,
                email_reminder_suspension_email_normalized AS candidate
         FROM users WHERE id = ?`,
      )
      .bind(userId)
      .first<{ reason: string | null; candidate: string | null }>();
    if (current === null) return "not_found";
    if (current.reason !== "identity_email_conflict" || current.candidate === null) {
      return "not_suspended";
    }

    const [result] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE users
           SET email_reminder_suspension_reason = NULL,
               email_reminder_suspension_email_normalized = NULL,
               email_reminders_paused = 1,
               email_reminder_revision = email_reminder_revision + 1,
               updated_at = ?
           WHERE id = ?
             AND email_reminder_suspension_reason = 'identity_email_conflict'
             AND email_reminder_suspension_email_normalized = ?
             AND NOT EXISTS (
               SELECT 1 FROM users AS owner
               WHERE owner.id <> users.id
                 AND owner.email_normalized = users.email_reminder_suspension_email_normalized
             )`,
        )
        .bind(now, userId, current.candidate),
      this.cancelDeliveriesForUserRevisionStatement(userId, now),
    ]);
    return (result?.meta.changes ?? 0) > 0 ? "cleared" : "still_conflicted";
  }

  async completeOnboarding(userId: string, now: number): Promise<AppUser | null> {
    await this.db
      .prepare(
        `UPDATE users
         SET onboarding_completed_at = ?, updated_at = ?
         WHERE id = ? AND onboarding_completed_at IS NULL`,
      )
      .bind(now, now, userId)
      .run();
    return this.getUser(userId);
  }

  async listCategories(userId: string): Promise<AppCategory[]> {
    const result = await this.db
      .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY position, name, id")
      .bind(userId)
      .all<CategoryRow>();
    return result.results.map(mapCategoryRow);
  }

  async getCategory(userId: string, id: string): Promise<AppCategory | null> {
    const row = await this.db
      .prepare("SELECT * FROM categories WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .first<CategoryRow>();
    return row === null ? null : mapCategoryRow(row);
  }

  async createCategory(userId: string, value: CategoryWrite): Promise<AppCategory | null> {
    const created = await this.createCategories(userId, [value]);
    return created?.[0] ?? null;
  }

  async createCategories(userId: string, values: CategoryWrite[]): Promise<AppCategory[] | null> {
    if (values.length < 1 || values.length > CATEGORY_BATCH_LIMIT) {
      throw new RangeError(
        `Category batches must contain between 1 and ${CATEGORY_BATCH_LIMIT} records.`,
      );
    }
    const serialized = JSON.stringify(values);
    const result = await this.db
      .prepare(
        `INSERT INTO categories (
           user_id, id, name, name_key, color, symbol_type, symbol_value,
           position, created_at, updated_at
         )
         SELECT ?,
                json_extract(item.value, '$.id'),
                json_extract(item.value, '$.name'),
                json_extract(item.value, '$.nameKey'),
                json_extract(item.value, '$.color'),
                json_extract(item.value, '$.symbol.type'),
                json_extract(item.value, '$.symbol.value'),
                CAST(json_extract(item.value, '$.position') AS INTEGER),
                CAST(json_extract(item.value, '$.createdAt') AS INTEGER),
                CAST(json_extract(item.value, '$.updatedAt') AS INTEGER)
         FROM json_each(?) AS item
         WHERE (
           SELECT COUNT(*) FROM categories WHERE user_id = ?
         ) + json_array_length(?) <= 100`,
      )
      .bind(userId, serialized, userId, serialized)
      .run();
    if (result.meta.changes === 0) return null;
    if (result.meta.changes < values.length) {
      throw new Error("The category batch was not written atomically.");
    }
    return values.map((value) => ({ ...value }));
  }

  async updateCategory(
    userId: string,
    id: string,
    patch: Partial<Pick<AppCategory, "name" | "nameKey" | "color" | "symbol" | "position">>,
    now: number,
  ): Promise<AppCategory | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of [
      ["name", "name"],
      ["nameKey", "name_key"],
      ["color", "color"],
      ["position", "position"],
    ] as const) {
      const value = patch[field];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(value);
      }
    }
    if ("symbol" in patch) {
      const [symbolType, symbolValue] = symbolColumns(patch.symbol ?? null);
      assignments.push("symbol_type = ?", "symbol_value = ?");
      values.push(symbolType, symbolValue);
    }
    assignments.push("updated_at = ?");
    values.push(now, userId, id);
    const result = await this.db
      .prepare(`UPDATE categories SET ${assignments.join(", ")} WHERE user_id = ? AND id = ?`)
      .bind(...values)
      .run();
    return result.meta.changes === 0 ? null : this.getCategory(userId, id);
  }

  async deleteCategory(userId: string, id: string, now: number): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE subscriptions SET category_id = NULL, updated_at = ?
           WHERE user_id = ? AND category_id = ?`,
        )
        .bind(now, userId, id),
      this.db.prepare("DELETE FROM categories WHERE user_id = ? AND id = ?").bind(userId, id),
    ]);
    return (results[1]?.meta.changes ?? 0) > 0;
  }

  async listPaymentMethods(userId: string): Promise<AppPaymentMethod[]> {
    const result = await this.db
      .prepare("SELECT * FROM payment_methods WHERE user_id = ? ORDER BY position, name, id")
      .bind(userId)
      .all<PaymentMethodRow>();
    return result.results.map(mapPaymentMethodRow);
  }

  async getPaymentMethod(userId: string, id: string): Promise<AppPaymentMethod | null> {
    const row = await this.db
      .prepare("SELECT * FROM payment_methods WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .first<PaymentMethodRow>();
    return row === null ? null : mapPaymentMethodRow(row);
  }

  async createPaymentMethod(
    userId: string,
    value: PaymentMethodWrite,
  ): Promise<AppPaymentMethod | null> {
    const result = await this.db
      .prepare(
        `INSERT INTO payment_methods (
           user_id, id, name, kind, label, symbol_type, symbol_value,
           position, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM payment_methods WHERE user_id = ?) < 100`,
      )
      .bind(
        userId,
        value.id,
        value.name,
        value.kind,
        value.label,
        ...symbolColumns(value.symbol),
        value.position,
        value.createdAt,
        value.updatedAt,
        userId,
      )
      .run();
    return result.meta.changes === 0 ? null : { ...value };
  }

  async updatePaymentMethod(
    userId: string,
    id: string,
    patch: Partial<Pick<AppPaymentMethod, "name" | "kind" | "label" | "symbol" | "position">>,
    now: number,
  ): Promise<AppPaymentMethod | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of [
      ["name", "name"],
      ["kind", "kind"],
      ["label", "label"],
      ["position", "position"],
    ] as const) {
      if (field in patch) {
        assignments.push(`${column} = ?`);
        values.push(patch[field] ?? null);
      }
    }
    if ("symbol" in patch) {
      const [symbolType, symbolValue] = symbolColumns(patch.symbol ?? null);
      assignments.push("symbol_type = ?", "symbol_value = ?");
      values.push(symbolType, symbolValue);
    }
    assignments.push("updated_at = ?");
    values.push(now, userId, id);
    const result = await this.db
      .prepare(`UPDATE payment_methods SET ${assignments.join(", ")} WHERE user_id = ? AND id = ?`)
      .bind(...values)
      .run();
    return result.meta.changes === 0 ? null : this.getPaymentMethod(userId, id);
  }

  async deletePaymentMethod(userId: string, id: string, now: number): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE subscriptions SET payment_method_id = NULL, updated_at = ?
           WHERE user_id = ? AND payment_method_id = ?`,
        )
        .bind(now, userId, id),
      this.db.prepare("DELETE FROM payment_methods WHERE user_id = ? AND id = ?").bind(userId, id),
    ]);
    return (results[1]?.meta.changes ?? 0) > 0;
  }

  async listSubscriptions(
    userId: string,
    filter: SubscriptionListFilter,
  ): Promise<AppSubscription[]> {
    const clauses = ["user_id = ?"];
    const values: unknown[] = [userId];
    if (filter.query !== undefined) {
      clauses.push("lower(name) LIKE ? ESCAPE '\\'");
      values.push(`%${escapeLike(filter.query.toLowerCase())}%`);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    if (filter.archived === "exclude") clauses.push("archived_at IS NULL");
    if (filter.archived === "only") clauses.push("archived_at IS NOT NULL");
    if ("categoryId" in filter) {
      if (filter.categoryId === null) clauses.push("category_id IS NULL");
      else {
        clauses.push("category_id = ?");
        values.push(filter.categoryId);
      }
    }
    if ("paymentMethodId" in filter) {
      if (filter.paymentMethodId === null) clauses.push("payment_method_id IS NULL");
      else {
        clauses.push("payment_method_id = ?");
        values.push(filter.paymentMethodId);
      }
    }
    if (filter.currency !== undefined) {
      clauses.push("currency = ?");
      values.push(filter.currency);
    }
    const sortColumns = {
      nextBillingOn: "next_billing_on",
      name: "name",
      amount: "amount_micros",
      createdAt: "created_at",
    } as const;
    const direction = filter.order === "desc" ? "DESC" : "ASC";
    const result = await this.db
      .prepare(
        `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM subscriptions
         WHERE ${clauses.join(" AND ")}
         ORDER BY ${sortColumns[filter.sort]} ${direction}, name ASC, id ASC`,
      )
      .bind(...values)
      .all<SubscriptionRow>();
    return result.results.map(mapSubscriptionRow);
  }

  async listAllSubscriptions(userId: string): Promise<AppSubscription[]> {
    const result = await this.db
      .prepare(
        `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM subscriptions WHERE user_id = ? ORDER BY id`,
      )
      .bind(userId)
      .all<SubscriptionRow>();
    return result.results.map(mapSubscriptionRow);
  }

  async readExportSnapshot(userId: string): Promise<ExportSnapshot> {
    const [user, categories, paymentMethods, subscriptions] = await this.db.batch([
      this.db.prepare("SELECT * FROM users WHERE id = ?").bind(userId),
      this.db
        .prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY position, name, id")
        .bind(userId),
      this.db
        .prepare("SELECT * FROM payment_methods WHERE user_id = ? ORDER BY position, name, id")
        .bind(userId),
      this.db
        .prepare(
          `SELECT ${SUBSCRIPTION_COLUMNS}
           FROM subscriptions WHERE user_id = ? ORDER BY id`,
        )
        .bind(userId),
    ]);

    const userRow = user?.results[0] as UserRow | undefined;
    return {
      user: userRow === undefined ? null : mapUserRow(userRow),
      categories: (categories?.results as CategoryRow[] | undefined)?.map(mapCategoryRow) ?? [],
      paymentMethods:
        (paymentMethods?.results as PaymentMethodRow[] | undefined)?.map(mapPaymentMethodRow) ?? [],
      subscriptions:
        (subscriptions?.results as SubscriptionRow[] | undefined)?.map(mapSubscriptionRow) ?? [],
    };
  }

  async listDashboardSubscriptions(userId: string) {
    const result = await this.db
      .prepare(
        `SELECT s.*,
                c.name AS category_name,
                c.color AS category_color,
                c.symbol_type AS category_symbol_type,
                c.symbol_value AS category_symbol_value,
                p.name AS payment_method_name,
                p.kind AS payment_method_kind,
                p.symbol_type AS payment_method_symbol_type,
                p.symbol_value AS payment_method_symbol_value
         FROM subscriptions s
         LEFT JOIN categories c ON c.user_id = s.user_id AND c.id = s.category_id
         LEFT JOIN payment_methods p ON p.user_id = s.user_id AND p.id = s.payment_method_id
         WHERE s.user_id = ?
         ORDER BY s.next_billing_on, s.name, s.id`,
      )
      .bind(userId)
      .all<DashboardSubscriptionRow>();
    return result.results.map(mapDashboardSubscriptionRow);
  }

  async getSubscription(userId: string, id: string): Promise<AppSubscription | null> {
    const row = await this.db
      .prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ? AND id = ?`)
      .bind(userId, id)
      .first<SubscriptionRow>();
    return row === null ? null : mapSubscriptionRow(row);
  }

  async createSubscription(
    userId: string,
    value: SubscriptionWrite,
  ): Promise<AppSubscription | null> {
    const result = await this.db
      .prepare(
        `${subscriptionInsertSql()}
         WHERE (SELECT COUNT(*) FROM subscriptions WHERE user_id = ?) < 50`,
      )
      .bind(...subscriptionValues(userId, value), userId)
      .run();
    return result.meta.changes === 0 ? null : { ...value };
  }

  async updateSubscription(
    userId: string,
    value: AppSubscription,
    expectedUpdatedAt: number,
    expectedEmailReminderRevision: number,
  ): Promise<AppSubscription | null> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE subscriptions SET
           name = ?, amount_micros = ?, currency = ?, recurrence_unit = ?,
           recurrence_count = ?, billing_anchor_on = ?, anchor_mode = ?,
           next_billing_on = ?, status = ?, cancelled_at = ?, archived_at = ?,
           category_id = ?, payment_method_id = ?, symbol_type = ?, symbol_value = ?,
           website_url = ?, notes = ?, email_reminder_enabled = ?,
           email_reminder_days_before = ?, email_reminder_revision = ?, updated_at = ?
         WHERE user_id = ? AND id = ?
           AND updated_at = ? AND email_reminder_revision = ?`,
        )
        .bind(
          value.name,
          value.amountMicros,
          value.currency,
          value.recurrence.unit,
          value.recurrence.count,
          value.recurrence.anchorOn,
          value.recurrence.anchorMode,
          value.nextBillingOn,
          value.status,
          value.cancelledAt,
          value.archivedAt,
          value.categoryId,
          value.paymentMethodId,
          ...symbolColumns(value.symbol),
          value.websiteUrl,
          value.notes,
          value.emailReminderEnabled ? 1 : 0,
          value.emailReminderDaysBefore,
          value.emailReminderRevision,
          value.updatedAt,
          userId,
          value.id,
          expectedUpdatedAt,
          expectedEmailReminderRevision,
        ),
      this.db
        .prepare(
          `UPDATE renewal_email_deliveries
           SET status = 'cancelled', next_attempt_at = NULL,
               last_error_code = 'preference_or_revision_changed', updated_at = ?
           WHERE user_id = ? AND subscription_id = ?
             AND status IN ('pending', 'retry_wait')
             AND EXISTS (
               SELECT 1 FROM subscriptions AS subscription
               WHERE subscription.user_id = renewal_email_deliveries.user_id
                 AND subscription.id = renewal_email_deliveries.subscription_id
                 AND subscription.updated_at = ?
                 AND subscription.email_reminder_revision = ?
             )
             AND (
               planned_subscription_reminder_revision <> (
                 SELECT subscription.email_reminder_revision
                 FROM subscriptions AS subscription
                 WHERE subscription.user_id = renewal_email_deliveries.user_id
                   AND subscription.id = renewal_email_deliveries.subscription_id
               )
               OR NOT EXISTS (
                 SELECT 1 FROM subscriptions AS subscription
                 WHERE subscription.user_id = renewal_email_deliveries.user_id
                   AND subscription.id = renewal_email_deliveries.subscription_id
                   AND subscription.email_reminder_enabled = 1
                   AND subscription.status = 'active'
                   AND subscription.archived_at IS NULL
               )
             )`,
        )
        .bind(value.updatedAt, userId, value.id, value.updatedAt, value.emailReminderRevision),
    ]);
    if ((results[0]?.meta.changes ?? 0) > 0) return value;
    if ((await this.getSubscription(userId, value.id)) === null) return null;
    throw new SubscriptionStateChangedError();
  }

  async deleteSubscription(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM subscriptions WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .run();
    return result.meta.changes > 0;
  }

  async reconcileSubscriptions(
    userId: string,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.reconciliationStatement(userId, updates).run();
  }

  private reconciliationStatement(
    userId: string,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE subscriptions AS subscription
         SET next_billing_on = json_extract(item.value, '$.nextBillingOn'),
             updated_at = CAST(json_extract(item.value, '$.updatedAt') AS INTEGER)
         FROM json_each(?) AS item
         WHERE subscription.user_id = ?
           AND subscription.id = json_extract(item.value, '$.id')
           AND subscription.status = 'active'`,
      )
      .bind(JSON.stringify(updates), userId);
  }

  async getFxSnapshot(): Promise<FxSnapshot | null> {
    const result = await this.db
      .prepare(
        `SELECT snapshot.id AS snapshot_id,
                snapshot.provider,
                snapshot.rate_date,
                snapshot.base_currency,
                snapshot.fetched_at,
                snapshot.rate_count,
                rate.currency AS rate_currency,
                rate.units_per_eur
         FROM fx_snapshot AS snapshot
         LEFT JOIN fx_rates AS rate ON rate.snapshot_id = snapshot.id
         WHERE snapshot.id = 1
         ORDER BY rate.currency`,
      )
      .all<FxSnapshotJoinRow>();
    return mapFxSnapshotRows(result.results);
  }

  async replaceFxSnapshot(snapshot: FxSnapshot): Promise<FxSnapshotReplaceResult> {
    const normalized = canonicalFxSnapshot(snapshot);
    const serializedRates = JSON.stringify(normalized.rates);
    const results = await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM fx_snapshot
           WHERE id = 1
             AND (provider <> ? OR rate_date < ?)`,
        )
        .bind(normalized.provider, normalized.rateDate),
      this.db
        .prepare(
          `INSERT INTO fx_snapshot (
             id, provider, rate_date, base_currency, fetched_at, rate_count
           )
           SELECT 1, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM fx_snapshot WHERE id = 1)`,
        )
        .bind(
          normalized.provider,
          normalized.rateDate,
          normalized.baseCurrency,
          normalized.fetchedAt,
          normalized.rates.length,
        ),
      this.db
        .prepare(
          `INSERT INTO fx_rates (snapshot_id, currency, units_per_eur)
           SELECT 1,
                  json_extract(item.value, '$.currency'),
                  json_extract(item.value, '$.unitsPerEur')
           FROM json_each(?) AS item
           WHERE EXISTS (
             SELECT 1
             FROM fx_snapshot
             WHERE id = 1
               AND provider = ?
               AND rate_date = ?
               AND base_currency = ?
               AND fetched_at = ?
               AND rate_count = ?
           )
           ON CONFLICT(snapshot_id, currency) DO NOTHING`,
        )
        .bind(
          serializedRates,
          normalized.provider,
          normalized.rateDate,
          normalized.baseCurrency,
          normalized.fetchedAt,
          normalized.rates.length,
        ),
    ]);
    return (results[1]?.meta.changes ?? 0) > 0 ? "replaced" : "unchanged";
  }

  async getImportState(userId: string): Promise<ExistingImportState> {
    const [user, categories, paymentMethods, subscriptions] = await this.db.batch([
      this.db.prepare("SELECT resource_revision FROM users WHERE id = ?").bind(userId),
      this.db.prepare("SELECT id, name_key FROM categories WHERE user_id = ?").bind(userId),
      this.db.prepare("SELECT id FROM payment_methods WHERE user_id = ?").bind(userId),
      this.db
        .prepare("SELECT id, email_reminder_enabled FROM subscriptions WHERE user_id = ?")
        .bind(userId),
    ]);
    const categoryRows = categories?.results as Array<{ id: string; name_key: string }>;
    const paymentMethodRows = paymentMethods?.results as Array<{ id: string }>;
    const subscriptionRows = subscriptions?.results as Array<{
      id: string;
      email_reminder_enabled: number;
    }>;
    return {
      resourceRevision: Number(
        (user?.results[0] as { resource_revision?: number } | undefined)?.resource_revision ?? -1,
      ),
      categoryIds: new Set(categoryRows.map((row) => row.id)),
      paymentMethodIds: new Set(paymentMethodRows.map((row) => row.id)),
      subscriptionIds: new Set(subscriptionRows.map((row) => row.id)),
      categoryNameKeysById: new Map(categoryRows.map((row) => [row.id, row.name_key])),
      emailReminderEnabledBySubscriptionId: new Map(
        subscriptionRows.map((row) => [row.id, row.email_reminder_enabled === 1]),
      ),
    };
  }

  async applyImport(
    userId: string,
    guard: ImportApplyGuard,
    mutations: ImportMutation[],
    profilePatch: UserUpdatePatch | null,
    reconciliationUpdates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
    forcePauseWhenEnabled: boolean,
  ): Promise<ImportApplyOutcome> {
    const statements: D1PreparedStatement[] = [this.importStateGuardStatement(userId, guard)];
    if (profilePatch !== null) {
      statements.push(this.userUpdateStatement(userId, profilePatch, now));
    }
    if (reconciliationUpdates.length > 0) {
      statements.push(this.reconciliationStatement(userId, reconciliationUpdates));
    }

    const categoryInserts: CategoryWrite[] = [];
    const categoryOverwrites: CategoryWrite[] = [];
    const paymentMethodInserts: PaymentMethodWrite[] = [];
    const paymentMethodOverwrites: PaymentMethodWrite[] = [];
    const subscriptionInserts: SubscriptionWrite[] = [];
    const subscriptionOverwrites: SubscriptionWrite[] = [];

    for (const mutation of mutations) {
      if (mutation.category !== undefined) {
        (mutation.kind === "insert" ? categoryInserts : categoryOverwrites).push(mutation.category);
      } else if (mutation.paymentMethod !== undefined) {
        (mutation.kind === "insert" ? paymentMethodInserts : paymentMethodOverwrites).push(
          mutation.paymentMethod,
        );
      } else if (mutation.subscription !== undefined) {
        (mutation.kind === "insert" ? subscriptionInserts : subscriptionOverwrites).push(
          mutation.subscription,
        );
      }
    }

    for (const values of chunks(categoryInserts)) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO categories (
               user_id, id, name, name_key, color, symbol_type, symbol_value,
               position, created_at, updated_at
             )
             SELECT ?,
                    json_extract(item.value, '$.id'),
                    json_extract(item.value, '$.name'),
                    json_extract(item.value, '$.nameKey'),
                    json_extract(item.value, '$.color'),
                    json_extract(item.value, '$.symbol.type'),
                    json_extract(item.value, '$.symbol.value'),
                    CAST(json_extract(item.value, '$.position') AS INTEGER),
                    CAST(json_extract(item.value, '$.createdAt') AS INTEGER),
                    CAST(json_extract(item.value, '$.updatedAt') AS INTEGER)
             FROM json_each(?) AS item`,
          )
          .bind(userId, JSON.stringify(values)),
      );
    }
    for (const values of chunks(categoryOverwrites)) {
      statements.push(
        this.db
          .prepare(
            `UPDATE categories AS category
             SET name = json_extract(item.value, '$.name'),
                 name_key = json_extract(item.value, '$.nameKey'),
                 color = json_extract(item.value, '$.color'),
                 symbol_type = json_extract(item.value, '$.symbol.type'),
                 symbol_value = json_extract(item.value, '$.symbol.value'),
                 position = CAST(json_extract(item.value, '$.position') AS INTEGER),
                 updated_at = ?
             FROM json_each(?) AS item
             WHERE category.user_id = ?
               AND category.id = json_extract(item.value, '$.id')`,
          )
          .bind(now, JSON.stringify(values), userId),
      );
    }
    for (const values of chunks(paymentMethodInserts)) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO payment_methods (
               user_id, id, name, kind, label, symbol_type, symbol_value,
               position, created_at, updated_at
             )
             SELECT ?,
                    json_extract(item.value, '$.id'),
                    json_extract(item.value, '$.name'),
                    json_extract(item.value, '$.kind'),
                    json_extract(item.value, '$.label'),
                    json_extract(item.value, '$.symbol.type'),
                    json_extract(item.value, '$.symbol.value'),
                    CAST(json_extract(item.value, '$.position') AS INTEGER),
                    CAST(json_extract(item.value, '$.createdAt') AS INTEGER),
                    CAST(json_extract(item.value, '$.updatedAt') AS INTEGER)
             FROM json_each(?) AS item`,
          )
          .bind(userId, JSON.stringify(values)),
      );
    }
    for (const values of chunks(paymentMethodOverwrites)) {
      statements.push(
        this.db
          .prepare(
            `UPDATE payment_methods AS payment_method
             SET name = json_extract(item.value, '$.name'),
                 kind = json_extract(item.value, '$.kind'),
                 label = json_extract(item.value, '$.label'),
                 symbol_type = json_extract(item.value, '$.symbol.type'),
                 symbol_value = json_extract(item.value, '$.symbol.value'),
                 position = CAST(json_extract(item.value, '$.position') AS INTEGER),
                 updated_at = ?
             FROM json_each(?) AS item
             WHERE payment_method.user_id = ?
               AND payment_method.id = json_extract(item.value, '$.id')`,
          )
          .bind(now, JSON.stringify(values), userId),
      );
    }
    for (const values of chunks(subscriptionInserts)) {
      statements.push(this.importSubscriptionInsertStatement(userId, values));
    }
    for (const values of chunks(subscriptionOverwrites)) {
      statements.push(this.importSubscriptionOverwriteStatement(userId, values, now));
    }
    if (profilePatch !== null) {
      statements.push(this.cancelDeliveriesForUserRevisionStatement(userId, now));
    }
    if (subscriptionOverwrites.length > 0) {
      statements.push(
        this.db
          .prepare(
            `UPDATE renewal_email_deliveries AS delivery
             SET status = 'cancelled', next_attempt_at = NULL,
                 last_error_code = 'preference_or_revision_changed', updated_at = ?
             WHERE delivery.user_id = ?
               AND delivery.status IN ('pending', 'retry_wait')
               AND delivery.planned_subscription_reminder_revision <> (
                 SELECT subscription.email_reminder_revision
                 FROM subscriptions AS subscription
                 WHERE subscription.user_id = delivery.user_id
                   AND subscription.id = delivery.subscription_id
               )`,
          )
          .bind(now, userId),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE users
           SET email_reminders_paused = 1, updated_at = ?
           WHERE id = ? AND ? = 1
             AND EXISTS (
               SELECT 1 FROM subscriptions
               WHERE user_id = ? AND email_reminder_enabled = 1
             )`,
        )
        .bind(now, userId, forcePauseWhenEnabled ? 1 : 0, userId),
    );
    const impactIndex = statements.length;
    statements.push(
      this.db
        .prepare(
          `SELECT COUNT(*) AS enabled_count
           FROM subscriptions
           WHERE user_id = ? AND email_reminder_enabled = 1`,
        )
        .bind(userId),
    );
    let results: D1Result[];
    try {
      results = await this.db.batch(statements);
    } catch (error) {
      if (isImportStateGuardFailure(error)) throw new ImportStateChangedError();
      throw error;
    }
    if ((results[0]?.meta.changes ?? 0) === 0) throw new ImportStateChangedError();
    const impact = results[impactIndex]?.results[0] as { enabled_count?: number } | undefined;
    const enabledPreferencesAfterApply = Number(impact?.enabled_count ?? 0);
    return {
      enabledPreferencesAfterApply,
      forcedGlobalPause: forcePauseWhenEnabled && enabledPreferencesAfterApply > 0,
    };
  }

  async maintainReminderDeliveries(now: number): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE renewal_email_deliveries
           SET status = 'unknown', lease_expires_at = NULL,
               last_error_code = 'lease_expired_ambiguous', updated_at = ?
           WHERE status = 'sending' AND lease_expires_at <= ?`,
        )
        .bind(now, now),
      this.db
        .prepare(
          `UPDATE renewal_email_deliveries
           SET status = 'expired', next_attempt_at = NULL,
               last_error_code = 'delivery_window_expired', updated_at = ?
           WHERE status IN ('pending', 'retry_wait') AND expires_at <= ?`,
        )
        .bind(now, now),
      this.db
        .prepare(
          `UPDATE renewal_email_deliveries AS delivery
           SET status = 'cancelled', next_attempt_at = NULL,
               last_error_code = 'preference_or_revision_changed', updated_at = ?
           WHERE delivery.status IN ('pending', 'retry_wait')
             AND EXISTS (
               SELECT 1
               FROM users AS user
               JOIN subscriptions AS subscription
                 ON subscription.user_id = user.id
                AND subscription.id = delivery.subscription_id
               WHERE user.id = delivery.user_id
                 AND (
                   subscription.email_reminder_enabled = 0
                   OR subscription.status <> 'active'
                   OR subscription.archived_at IS NOT NULL
                   OR user.email_reminder_revision <> delivery.planned_user_reminder_revision
                   OR subscription.email_reminder_revision <>
                     delivery.planned_subscription_reminder_revision
                 )
             )`,
        )
        .bind(now),
    ]);
  }

  async listReminderPlanningCandidates(): Promise<ReminderPlanningCandidate[]> {
    const [users, subscriptions] = await Promise.all([
      this.db
        .prepare(
          `SELECT user.*
           FROM users AS user
           WHERE user.email_reminders_paused = 0
             AND user.email_reminder_suspension_reason IS NULL
             AND EXISTS (
               SELECT 1 FROM subscriptions AS subscription
               WHERE subscription.user_id = user.id
                 AND subscription.email_reminder_enabled = 1
                 AND subscription.status = 'active'
                 AND subscription.archived_at IS NULL
             )
           ORDER BY user.id`,
        )
        .all<UserRow>(),
      this.db
        .prepare(
          `SELECT subscription.*
           FROM subscriptions AS subscription
           WHERE subscription.email_reminder_enabled = 1
             AND subscription.status = 'active'
             AND subscription.archived_at IS NULL
             AND EXISTS (
               SELECT 1 FROM users AS user
               WHERE user.id = subscription.user_id
                 AND user.email_reminders_paused = 0
                 AND user.email_reminder_suspension_reason IS NULL
             )
           ORDER BY subscription.user_id, subscription.id`,
        )
        .all<SubscriptionRow>(),
    ]);
    const usersById = new Map(users.results.map((row) => [row.id, mapUserRow(row)]));
    return subscriptions.results.flatMap((row) => {
      const user = usersById.get(row.user_id);
      return user === undefined ? [] : [{ user, subscription: mapSubscriptionRow(row) }];
    });
  }

  async upsertReminderDeliveryPlan(value: ReminderDeliveryPlanWrite): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO renewal_email_deliveries (
           id, user_id, subscription_id, billing_on, effective_days_before,
           intended_send_at, expires_at, status, attempt_count,
           planned_user_reminder_revision, planned_subscription_reminder_revision,
           created_at, updated_at
         )
         SELECT ?, subscription.user_id, subscription.id, ?, ?, ?, ?, 'pending', 0,
                ?, ?, ?, ?
         FROM subscriptions AS subscription
         JOIN users AS user ON user.id = subscription.user_id
         WHERE subscription.user_id = ?
           AND subscription.id = ?
           AND subscription.email_reminder_enabled = 1
           AND subscription.status = 'active'
           AND subscription.archived_at IS NULL
           AND subscription.email_reminder_revision = ?
           AND user.email_reminders_paused = 0
           AND user.email_reminder_suspension_reason IS NULL
           AND user.email_reminder_revision = ?
         ON CONFLICT(user_id, subscription_id, billing_on) DO UPDATE SET
           effective_days_before = excluded.effective_days_before,
           intended_send_at = excluded.intended_send_at,
           expires_at = excluded.expires_at,
           status = 'pending',
           claimed_at = NULL,
           lease_expires_at = NULL,
           next_attempt_at = NULL,
           last_error_code = NULL,
           planned_user_reminder_revision = excluded.planned_user_reminder_revision,
           planned_subscription_reminder_revision =
             excluded.planned_subscription_reminder_revision,
           updated_at = excluded.updated_at
         WHERE renewal_email_deliveries.attempt_count = 0
           AND renewal_email_deliveries.status IN ('pending', 'cancelled')
           AND excluded.expires_at > ?`,
      )
      .bind(
        value.id,
        value.billingOn,
        value.effectiveDaysBefore,
        value.intendedSendAt,
        value.expiresAt,
        value.plannedUserReminderRevision,
        value.plannedSubscriptionReminderRevision,
        value.now,
        value.now,
        value.userId,
        value.subscriptionId,
        value.plannedSubscriptionReminderRevision,
        value.plannedUserReminderRevision,
        value.now,
      )
      .run();
    return result.meta.changes > 0;
  }

  async listDueReminderDeliveries(
    now: number,
    limit: number,
  ): Promise<ReminderDeliveryCandidate[]> {
    const rows = await this.db
      .prepare(
        `SELECT delivery.*
         FROM renewal_email_deliveries AS delivery
         JOIN users AS user ON user.id = delivery.user_id
         JOIN subscriptions AS subscription
           ON subscription.user_id = delivery.user_id
          AND subscription.id = delivery.subscription_id
         WHERE delivery.expires_at > ?
           AND (
             (delivery.status = 'pending' AND delivery.intended_send_at <= ?)
             OR
             (delivery.status = 'retry_wait' AND delivery.next_attempt_at <= ?)
           )
           AND user.email_reminders_paused = 0
           AND user.email_reminder_suspension_reason IS NULL
           AND user.email_reminder_revision = delivery.planned_user_reminder_revision
           AND subscription.email_reminder_enabled = 1
           AND subscription.status = 'active'
           AND subscription.archived_at IS NULL
           AND subscription.email_reminder_revision =
             delivery.planned_subscription_reminder_revision
         ORDER BY COALESCE(delivery.next_attempt_at, delivery.intended_send_at), delivery.id
         LIMIT ?`,
      )
      .bind(now, now, now, Math.max(1, Math.min(limit, 100)))
      .all<RenewalEmailDeliveryRow>();
    return this.loadReminderDeliveryCandidates(rows.results);
  }

  async claimReminderDelivery(
    id: string,
    now: number,
    leaseExpiresAt: number,
    configuration: ReminderProviderConfiguration,
  ): Promise<ReminderDeliveryCandidate | null> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE renewal_email_deliveries
           SET status = 'cancelled', next_attempt_at = NULL,
               last_error_code = 'provider_configuration_changed', updated_at = ?
           WHERE id = ? AND status = 'retry_wait' AND attempt_count > 0
             AND (
               provider_key IS NOT ?
               OR provider_config_revision IS NOT ?
               OR template_version IS NOT ?
             )`,
        )
        .bind(
          now,
          id,
          configuration.providerKey,
          configuration.providerConfigRevision,
          configuration.templateVersion,
        ),
      this.db
        .prepare(
          `UPDATE renewal_email_deliveries AS delivery
           SET status = 'sending',
               attempt_count = attempt_count + 1,
               claimed_at = ?,
               lease_expires_at = ?,
               next_attempt_at = NULL,
               provider_key = COALESCE(provider_key, ?),
               provider_config_revision = COALESCE(provider_config_revision, ?),
               application_idempotency_key = COALESCE(
                 application_idempotency_key,
                 'renewal:' || user_id || ':' || subscription_id || ':' || billing_on
               ),
               template_version = COALESCE(template_version, ?),
               last_error_code = NULL,
               updated_at = ?
           WHERE delivery.id = ?
             AND delivery.expires_at > ?
             AND delivery.attempt_count < 3
             AND (
               (delivery.status = 'pending' AND delivery.intended_send_at <= ?)
               OR
               (delivery.status = 'retry_wait' AND delivery.next_attempt_at <= ?)
             )
             AND EXISTS (
               SELECT 1
               FROM users AS user
               JOIN subscriptions AS subscription
                 ON subscription.user_id = user.id
                AND subscription.id = delivery.subscription_id
               WHERE user.id = delivery.user_id
                 AND user.email_reminders_paused = 0
                 AND user.email_reminder_suspension_reason IS NULL
                 AND user.email_reminder_revision = delivery.planned_user_reminder_revision
                 AND subscription.email_reminder_enabled = 1
                 AND subscription.status = 'active'
                 AND subscription.archived_at IS NULL
                 AND subscription.email_reminder_revision =
                   delivery.planned_subscription_reminder_revision
             )`,
        )
        .bind(
          now,
          leaseExpiresAt,
          configuration.providerKey,
          configuration.providerConfigRevision,
          configuration.templateVersion,
          now,
          id,
          now,
          now,
          now,
        ),
      this.db.prepare("SELECT * FROM renewal_email_deliveries WHERE id = ?").bind(id),
      this.db
        .prepare(
          `SELECT user.* FROM users AS user
           JOIN renewal_email_deliveries AS delivery ON delivery.user_id = user.id
           WHERE delivery.id = ?`,
        )
        .bind(id),
      this.db
        .prepare(
          `SELECT subscription.*
           FROM subscriptions AS subscription
           JOIN renewal_email_deliveries AS delivery
             ON delivery.user_id = subscription.user_id
            AND delivery.subscription_id = subscription.id
           WHERE delivery.id = ?`,
        )
        .bind(id),
    ]);
    if ((results[1]?.meta.changes ?? 0) === 0) return null;
    const deliveryRow = results[2]?.results[0] as RenewalEmailDeliveryRow | undefined;
    const userRow = results[3]?.results[0] as UserRow | undefined;
    const subscriptionRow = results[4]?.results[0] as SubscriptionRow | undefined;
    if (deliveryRow === undefined || userRow === undefined || subscriptionRow === undefined) {
      throw new Error("Claimed reminder candidate could not be read atomically.");
    }
    return {
      delivery: mapRenewalEmailDeliveryRow(deliveryRow),
      user: mapUserRow(userRow),
      subscription: mapSubscriptionRow(subscriptionRow),
    };
  }

  async recordReminderDeliveryOutcome(
    id: string,
    attemptCount: number,
    outcome: ReminderEmailSendOutcome,
    now: number,
    nextAttemptAt: number | null,
  ): Promise<boolean> {
    const errorCode =
      outcome.kind === "accepted" ? null : normalizeReminderErrorCode(outcome.errorCode);
    let status: AppRenewalEmailDelivery["status"];
    let storedErrorCode = errorCode;
    let retryAt: number | null = null;
    if (outcome.kind === "accepted") {
      status = "sent";
    } else if (outcome.kind === "ambiguous") {
      status = "unknown";
    } else if (outcome.kind === "permanent") {
      status = "failed";
    } else if (attemptCount >= 3) {
      status = "failed";
      storedErrorCode = "retry_exhausted";
    } else if (nextAttemptAt === null) {
      status = "failed";
      storedErrorCode = "retry_window_closed";
    } else {
      status = "retry_wait";
      retryAt = nextAttemptAt;
    }

    const result = await this.db
      .prepare(
        `UPDATE renewal_email_deliveries
         SET status = ?, lease_expires_at = NULL, next_attempt_at = ?,
             sent_at = ?, provider_message_id = ?, last_error_code = ?, updated_at = ?
         WHERE id = ? AND status = 'sending' AND attempt_count = ?`,
      )
      .bind(
        status,
        retryAt,
        status === "sent" ? now : null,
        outcome.kind === "accepted" ? outcome.providerMessageId : null,
        storedErrorCode,
        now,
        id,
        attemptCount,
      )
      .run();
    return result.meta.changes > 0;
  }

  async listSubscriptionReminderDeliveries(
    userId: string,
    subscriptionId: string,
    limit: number,
  ): Promise<AppRenewalEmailDelivery[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM renewal_email_deliveries
         WHERE user_id = ? AND subscription_id = ?
         ORDER BY intended_send_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(userId, subscriptionId, Math.max(1, Math.min(limit, 100)))
      .all<RenewalEmailDeliveryRow>();
    return result.results.map(mapRenewalEmailDeliveryRow);
  }

  private async loadReminderDeliveryCandidates(
    deliveryRows: readonly RenewalEmailDeliveryRow[],
  ): Promise<ReminderDeliveryCandidate[]> {
    if (deliveryRows.length === 0) return [];
    const userIds = [...new Set(deliveryRows.map((row) => row.user_id))];
    const subscriptionKeys = deliveryRows.map((row) => ({
      userId: row.user_id,
      subscriptionId: row.subscription_id,
    }));
    const [users, subscriptions] = await Promise.all([
      this.db
        .prepare("SELECT * FROM users WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(userIds))
        .all<UserRow>(),
      this.db
        .prepare(
          `SELECT subscription.*
           FROM subscriptions AS subscription
           JOIN json_each(?) AS item
             ON subscription.user_id = json_extract(item.value, '$.userId')
            AND subscription.id = json_extract(item.value, '$.subscriptionId')`,
        )
        .bind(JSON.stringify(subscriptionKeys))
        .all<SubscriptionRow>(),
    ]);
    const usersById = new Map(users.results.map((row) => [row.id, mapUserRow(row)]));
    const subscriptionsByKey = new Map(
      subscriptions.results.map((row) => [`${row.user_id}:${row.id}`, mapSubscriptionRow(row)]),
    );
    return deliveryRows.flatMap((row) => {
      const user = usersById.get(row.user_id);
      const subscription = subscriptionsByKey.get(`${row.user_id}:${row.subscription_id}`);
      return user === undefined || subscription === undefined
        ? []
        : [{ delivery: mapRenewalEmailDeliveryRow(row), user, subscription }];
    });
  }

  private importStateGuardStatement(userId: string, guard: ImportApplyGuard): D1PreparedStatement {
    const { user } = guard;
    return this.db
      .prepare(
        `UPDATE users
         SET primary_email = CASE WHEN
           resource_revision = ?
           AND primary_email IS ?
           AND display_name IS ?
           AND timezone IS ?
           AND reporting_currency IS ?
           AND onboarding_completed_at IS ?
           AND preferred_locale IS ?
           AND email_locale IS ?
           AND default_email_reminder_days_before IS ?
           AND email_reminder_local_time IS ?
           AND email_reminders_paused IS ?
           AND email_reminder_revision IS ?
           AND email_reminder_suspension_reason IS ?
           AND email_reminder_suspension_email_normalized IS ?
           AND created_at IS ?
           AND updated_at IS ?
         THEN primary_email ELSE NULL END
         WHERE id = ?`,
      )
      .bind(
        guard.resourceRevision,
        user.primaryEmail,
        user.displayName,
        user.timezone,
        user.reportingCurrency,
        user.onboardingCompletedAt,
        user.interfaceLocale,
        user.emailLocale,
        user.defaultEmailReminderDaysBefore,
        user.emailReminderLocalTime,
        user.emailRemindersPaused ? 1 : 0,
        user.emailReminderRevision,
        user.emailReminderSuspensionReason,
        user.emailReminderSuspensionEmailNormalized,
        user.createdAt,
        user.updatedAt,
        userId,
      );
  }

  private importSubscriptionInsertStatement(
    userId: string,
    values: SubscriptionWrite[],
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO subscriptions (
           user_id, id, name, amount_micros, currency, recurrence_unit,
           recurrence_count, billing_anchor_on, anchor_mode, next_billing_on,
           status, cancelled_at, archived_at, category_id, payment_method_id,
           symbol_type, symbol_value, website_url, notes, created_at, updated_at,
           email_reminder_enabled, email_reminder_days_before, email_reminder_revision
         )
         SELECT ?,
                json_extract(item.value, '$.id'),
                json_extract(item.value, '$.name'),
                CAST(json_extract(item.value, '$.amountMicros') AS INTEGER),
                json_extract(item.value, '$.currency'),
                json_extract(item.value, '$.recurrence.unit'),
                CAST(json_extract(item.value, '$.recurrence.count') AS INTEGER),
                json_extract(item.value, '$.recurrence.anchorOn'),
                json_extract(item.value, '$.recurrence.anchorMode'),
                json_extract(item.value, '$.nextBillingOn'),
                json_extract(item.value, '$.status'),
                CAST(json_extract(item.value, '$.cancelledAt') AS INTEGER),
                CAST(json_extract(item.value, '$.archivedAt') AS INTEGER),
                json_extract(item.value, '$.categoryId'),
                json_extract(item.value, '$.paymentMethodId'),
                json_extract(item.value, '$.symbol.type'),
                json_extract(item.value, '$.symbol.value'),
                json_extract(item.value, '$.websiteUrl'),
                json_extract(item.value, '$.notes'),
                CAST(json_extract(item.value, '$.createdAt') AS INTEGER),
                CAST(json_extract(item.value, '$.updatedAt') AS INTEGER),
                CAST(json_extract(item.value, '$.emailReminderEnabled') AS INTEGER),
                CAST(json_extract(item.value, '$.emailReminderDaysBefore') AS INTEGER),
                0
         FROM json_each(?) AS item`,
      )
      .bind(userId, JSON.stringify(values));
  }

  private importSubscriptionOverwriteStatement(
    userId: string,
    values: SubscriptionWrite[],
    now: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE subscriptions AS subscription
         SET name = json_extract(item.value, '$.name'),
             amount_micros = CAST(json_extract(item.value, '$.amountMicros') AS INTEGER),
             currency = json_extract(item.value, '$.currency'),
             recurrence_unit = json_extract(item.value, '$.recurrence.unit'),
             recurrence_count = CAST(json_extract(item.value, '$.recurrence.count') AS INTEGER),
             billing_anchor_on = json_extract(item.value, '$.recurrence.anchorOn'),
             anchor_mode = json_extract(item.value, '$.recurrence.anchorMode'),
             next_billing_on = json_extract(item.value, '$.nextBillingOn'),
             status = json_extract(item.value, '$.status'),
             cancelled_at = CAST(json_extract(item.value, '$.cancelledAt') AS INTEGER),
             archived_at = CAST(json_extract(item.value, '$.archivedAt') AS INTEGER),
             category_id = json_extract(item.value, '$.categoryId'),
             payment_method_id = json_extract(item.value, '$.paymentMethodId'),
             symbol_type = json_extract(item.value, '$.symbol.type'),
             symbol_value = json_extract(item.value, '$.symbol.value'),
             website_url = json_extract(item.value, '$.websiteUrl'),
             notes = json_extract(item.value, '$.notes'),
             email_reminder_enabled = CAST(
               json_extract(item.value, '$.emailReminderEnabled') AS INTEGER
             ),
             email_reminder_days_before = CAST(
               json_extract(item.value, '$.emailReminderDaysBefore') AS INTEGER
             ),
             email_reminder_revision = email_reminder_revision + CASE WHEN
               name IS NOT json_extract(item.value, '$.name')
               OR amount_micros IS NOT CAST(json_extract(item.value, '$.amountMicros') AS INTEGER)
               OR currency IS NOT json_extract(item.value, '$.currency')
               OR recurrence_unit IS NOT json_extract(item.value, '$.recurrence.unit')
               OR recurrence_count IS NOT CAST(json_extract(item.value, '$.recurrence.count') AS INTEGER)
               OR billing_anchor_on IS NOT json_extract(item.value, '$.recurrence.anchorOn')
               OR anchor_mode IS NOT json_extract(item.value, '$.recurrence.anchorMode')
               OR status IS NOT json_extract(item.value, '$.status')
               OR cancelled_at IS NOT CAST(json_extract(item.value, '$.cancelledAt') AS INTEGER)
               OR archived_at IS NOT CAST(json_extract(item.value, '$.archivedAt') AS INTEGER)
               OR email_reminder_enabled IS NOT CAST(
                 json_extract(item.value, '$.emailReminderEnabled') AS INTEGER
               )
               OR email_reminder_days_before IS NOT CAST(
                 json_extract(item.value, '$.emailReminderDaysBefore') AS INTEGER
               )
               THEN 1 ELSE 0 END,
             updated_at = ?
         FROM json_each(?) AS item
         WHERE subscription.user_id = ?
           AND subscription.id = json_extract(item.value, '$.id')`,
      )
      .bind(now, JSON.stringify(values), userId);
  }
}

function logIdentityRelink(userId: string, provider: AuthenticatedIdentity["provider"]): void {
  console.info(
    JSON.stringify({
      message: "security_audit",
      eventCode: "AUTH_IDENTITY_RELINKED",
      userId,
      provider,
    }),
  );
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isConstraintFailure(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed|constraint failed/i.test(error.message)
  );
}

function isImportStateGuardFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /NOT NULL constraint failed: users\.primary_email/i.test(error.message)
  );
}

function normalizeReminderErrorCode(value: string): string {
  return /^[a-z0-9_]{1,64}$/.test(value) ? value : "provider_error";
}

function subscriptionInsertSql(): string {
  return `INSERT INTO subscriptions (
    user_id, id, name, amount_micros, currency, recurrence_unit,
    recurrence_count, billing_anchor_on, anchor_mode, next_billing_on,
    status, cancelled_at, archived_at, category_id, payment_method_id,
    symbol_type, symbol_value, website_url, notes, created_at, updated_at,
    email_reminder_enabled, email_reminder_days_before, email_reminder_revision
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`;
}

function subscriptionValues(userId: string, value: SubscriptionWrite): unknown[] {
  return [
    userId,
    value.id,
    value.name,
    value.amountMicros,
    value.currency,
    value.recurrence.unit,
    value.recurrence.count,
    value.recurrence.anchorOn,
    value.recurrence.anchorMode,
    value.nextBillingOn,
    value.status,
    value.cancelledAt,
    value.archivedAt,
    value.categoryId,
    value.paymentMethodId,
    ...symbolColumns(value.symbol),
    value.websiteUrl,
    value.notes,
    value.createdAt,
    value.updatedAt,
    value.emailReminderEnabled ? 1 : 0,
    value.emailReminderDaysBefore,
    value.emailReminderRevision,
  ];
}

function symbolColumns(symbol: ResourceSymbol): [string | null, string | null] {
  return symbol === null ? [null, null] : [symbol.type, symbol.value];
}

function canonicalFxSnapshot(snapshot: FxSnapshot): FxSnapshot {
  return assertFxSnapshot({
    ...snapshot,
    rates: snapshot.rates.map((rate) => ({
      currency: rate.currency,
      unitsPerEur: canonicalizePositiveDecimal(rate.unitsPerEur),
    })),
  });
}

function chunks<T>(values: T[], size = 25): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

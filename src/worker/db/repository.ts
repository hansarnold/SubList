import type {
  AppCategory,
  AppPaymentMethod,
  AppSubscription,
  AppUser,
  AuthenticatedIdentity,
  ExistingImportState,
  SubscriptionListFilter,
} from "../../application/models";
import type {
  CategoryWrite,
  FxSnapshotReplaceResult,
  ImportMutation,
  OpenSubListsRepository,
  PaymentMethodWrite,
  SubscriptionWrite,
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
  type CategoryRow,
  type DashboardSubscriptionRow,
  type FxSnapshotJoinRow,
  type PaymentMethodRow,
  type SubscriptionRow,
  type UserRow,
} from "./rows";

const SUBSCRIPTION_COLUMNS = `
  user_id, id, name, amount_micros, currency, recurrence_unit,
  recurrence_count, billing_anchor_on, anchor_mode, next_billing_on,
  status, cancelled_at, archived_at, category_id, payment_method_id,
  symbol_type, symbol_value, website_url, notes, created_at, updated_at
`;

const CATEGORY_BATCH_LIMIT = 13;

export class D1OpenSubListsRepository implements OpenSubListsRepository {
  constructor(private readonly db: D1Database) {}

  async resolveUser(identity: AuthenticatedIdentity, now: number): Promise<AppUser> {
    const emailNormalized = normalizeEmailAddress(identity.email);
    const existing = await this.findUserByIdentity(identity);

    if (existing !== null) {
      const emailOwner = await this.db
        .prepare("SELECT id FROM users WHERE email_normalized = ?")
        .bind(emailNormalized)
        .first<{ id: string }>();
      const updates = [
        this.db
          .prepare(
            `UPDATE auth_identities
             SET email = ?, email_normalized = ?, last_seen_at = ?
             WHERE provider = ? AND subject = ?`,
          )
          .bind(identity.email, emailNormalized, now, identity.provider, identity.subject),
      ];
      if (emailOwner === null || emailOwner.id === existing.id) {
        updates.push(
          this.db
            .prepare(
              `UPDATE users
               SET primary_email = ?, email_normalized = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(identity.email, emailNormalized, now, existing.id),
        );
      }
      await this.db.batch(updates);
      return mapUserRow({
        ...existing,
        ...(emailOwner === null || emailOwner.id === existing.id
          ? {
              primary_email: identity.email,
              email_normalized: emailNormalized,
              updated_at: now,
            }
          : {}),
      });
    }

    const userWithEmail = await this.db
      .prepare("SELECT * FROM users WHERE email_normalized = ?")
      .bind(emailNormalized)
      .first<UserRow>();

    if (userWithEmail !== null) {
      await this.db
        .prepare(
          `INSERT INTO auth_identities (
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
      logIdentityRelink(userWithEmail.id, identity.provider);
      return mapUserRow(userWithEmail);
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
      createdAt: now,
      updatedAt: now,
    };
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

  async updateUser(
    userId: string,
    patch: Partial<Pick<AppUser, "displayName" | "timezone" | "reportingCurrency">>,
    now: number,
  ): Promise<AppUser | null> {
    await this.userUpdateStatement(userId, patch, now).run();
    return this.getUser(userId);
  }

  async updateUserWithReconciliation(
    userId: string,
    patch: Partial<Pick<AppUser, "displayName" | "timezone" | "reportingCurrency">>,
    updates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
  ): Promise<AppUser | null> {
    const statements = [this.userUpdateStatement(userId, patch, now)];
    if (updates.length > 0) {
      statements.push(this.reconciliationStatement(userId, updates));
    }
    await this.db.batch(statements);
    return this.getUser(userId);
  }

  private userUpdateStatement(
    userId: string,
    patch: Partial<Pick<AppUser, "displayName" | "timezone" | "reportingCurrency">>,
    now: number,
  ): D1PreparedStatement {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if ("displayName" in patch) {
      assignments.push("display_name = ?");
      values.push(patch.displayName ?? null);
    }
    if (patch.timezone !== undefined) {
      assignments.push("timezone = ?");
      values.push(patch.timezone);
    }
    if (patch.reportingCurrency !== undefined) {
      assignments.push("reporting_currency = ?");
      values.push(patch.reportingCurrency);
    }
    assignments.push("updated_at = ?");
    values.push(now, userId);
    return this.db
      .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
      .bind(...values);
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
    if (result.meta.changes !== values.length) {
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

  async deleteCategory(userId: string, id: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE subscriptions SET category_id = NULL WHERE user_id = ? AND category_id = ?",
        )
        .bind(userId, id),
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

  async deletePaymentMethod(userId: string, id: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE subscriptions SET payment_method_id = NULL WHERE user_id = ? AND payment_method_id = ?",
        )
        .bind(userId, id),
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
  ): Promise<AppSubscription | null> {
    const result = await this.db
      .prepare(
        `UPDATE subscriptions SET
           name = ?, amount_micros = ?, currency = ?, recurrence_unit = ?,
           recurrence_count = ?, billing_anchor_on = ?, anchor_mode = ?,
           next_billing_on = ?, status = ?, cancelled_at = ?, archived_at = ?,
           category_id = ?, payment_method_id = ?, symbol_type = ?, symbol_value = ?,
           website_url = ?, notes = ?, updated_at = ?
         WHERE user_id = ? AND id = ?`,
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
        value.updatedAt,
        userId,
        value.id,
      )
      .run();
    return result.meta.changes === 0 ? null : value;
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
    const [categories, paymentMethods, subscriptions] = await Promise.all([
      this.db
        .prepare("SELECT id, name_key FROM categories WHERE user_id = ?")
        .bind(userId)
        .all<{ id: string; name_key: string }>(),
      this.db
        .prepare("SELECT id FROM payment_methods WHERE user_id = ?")
        .bind(userId)
        .all<{ id: string }>(),
      this.db
        .prepare("SELECT id FROM subscriptions WHERE user_id = ?")
        .bind(userId)
        .all<{ id: string }>(),
    ]);
    return {
      categoryIds: new Set(categories.results.map((row) => row.id)),
      paymentMethodIds: new Set(paymentMethods.results.map((row) => row.id)),
      subscriptionIds: new Set(subscriptions.results.map((row) => row.id)),
      categoryNameKeysById: new Map(categories.results.map((row) => [row.id, row.name_key])),
    };
  }

  async applyImport(
    userId: string,
    mutations: ImportMutation[],
    profilePatch: Pick<AppUser, "displayName" | "timezone" | "reportingCurrency"> | null,
    reconciliationUpdates: Array<{ id: string; nextBillingOn: string; updatedAt: number }>,
    now: number,
  ): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    if (profilePatch !== null) {
      statements.push(
        this.db
          .prepare(
            `UPDATE users SET display_name = ?, timezone = ?, reporting_currency = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            profilePatch.displayName ?? null,
            profilePatch.timezone,
            profilePatch.reportingCurrency,
            now,
            userId,
          ),
      );
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

    if (statements.length > 0) await this.db.batch(statements);
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
           symbol_type, symbol_value, website_url, notes, created_at, updated_at
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
                CAST(json_extract(item.value, '$.updatedAt') AS INTEGER)
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

function subscriptionInsertSql(): string {
  return `INSERT INTO subscriptions (
    user_id, id, name, amount_micros, currency, recurrence_unit,
    recurrence_count, billing_anchor_on, anchor_mode, next_billing_on,
    status, cancelled_at, archived_at, category_id, payment_method_id,
    symbol_type, symbol_value, website_url, notes, created_at, updated_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`;
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

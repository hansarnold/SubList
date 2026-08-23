import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { OpenSubListsService } from "../../src/application/service";
import { importRequestSchema } from "../../src/shared/api-types/schemas";
import worker from "../../src/worker";
import { D1OpenSubListsRepository } from "../../src/worker/db/repository";

const migrations = inject("migrations");
const IncomingRequest = Request;
const ORIGIN = "http://localhost:5173";

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users").run();
});

describe("OpenSubLists Worker API", () => {
  it("provisions the fixed local identity and prevents shared caching", async () => {
    const response = await api("/api/v1/session");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json<{
      data: { environment: string; user: { email: string } };
    }>();
    expect(body.data.environment).toBe("local");
    expect(body.data.user.email).toBe("developer@localhost.invalid");
  });

  it("fails closed when local identity mode receives a remote-host request", async () => {
    const request = new IncomingRequest("https://app.example.com/api/v1/session");
    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("AUTH_CONFIGURATION_ERROR");
  });

  it("provisions one account when first-load requests arrive concurrently", async () => {
    const responses = await Promise.all([
      api("/api/v1/session"),
      api("/api/v1/categories"),
      api("/api/v1/payment-methods"),
      api("/api/v1/dashboard"),
    ]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const userCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<number>(
      "count",
    );
    const identityCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_identities",
    ).first<number>("count");
    expect(userCount).toBe(1);
    expect(identityCount).toBe(1);
  });

  it("rejects unsafe requests without the configured same origin", async () => {
    const response = await api("/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Utilities", color: "#3B82F6", position: 0 }),
    });
    expect(response.status).toBe(400);
    const body = await response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("INVALID_ORIGIN");
  });

  it("allows masked payment labels but rejects stored card numbers in CRUD and imports", async () => {
    const masked = await post<{ label: string }>("/api/v1/payment-methods", {
      name: "Personal Visa",
      kind: "card",
      label: "•••• 1234",
      position: 0,
    });
    expect(masked.label).toBe("•••• 1234");

    const createResponse = await api("/api/v1/payment-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({
        name: "Unsafe card",
        kind: "card",
        label: "4111 1111 1111 1111",
        position: 1,
      }),
    });
    expect(createResponse.status).toBe(422);

    const timestamp = new Date().toISOString();
    const archive = {
      ...archiveWithSubscriptions(0),
      paymentMethods: [
        {
          id: crypto.randomUUID(),
          name: "Imported unsafe card",
          kind: "card",
          label: "4111111111111111",
          position: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
    const importResponse = await api("/api/v1/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ archive }),
    });
    expect(importResponse.status).toBe(422);
  });

  it("creates tenant resources and expands every dashboard occurrence", async () => {
    const category = await post<{ id: string }>("/api/v1/categories", {
      name: "Development Tools",
      color: "#6366F1",
      position: 0,
    });
    const paymentMethod = await post<{ id: string }>("/api/v1/payment-methods", {
      name: "Visa",
      kind: "card",
      label: "•••• 1234",
      position: 0,
    });
    const subscription = await post<{ id: string; amount: string }>("/api/v1/subscriptions", {
      name: "Daily Service",
      amount: "9.99",
      currency: "USD",
      recurrence: {
        unit: "day",
        count: 1,
        anchorOn: "2020-01-01",
        anchorMode: "calendar_day",
      },
      categoryId: category.id,
      paymentMethodId: paymentMethod.id,
      websiteUrl: "https://example.com",
      notes: null,
    });
    expect(subscription.amount).toBe("9.99");

    const dashboardResponse = await api("/api/v1/dashboard?upcomingDays=3");
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json<{
      data: {
        upcoming: Array<{ subscriptionId: string }>;
        totalsByCurrency: Array<{ currency: string; upcomingAmount: string }>;
        categoryBreakdown: Array<{ subscriptionCount: number }>;
      };
    }>();
    expect(dashboard.data.upcoming).toHaveLength(3);
    expect(dashboard.data.upcoming.every((item) => item.subscriptionId === subscription.id)).toBe(
      true,
    );
    expect(dashboard.data.totalsByCurrency).toContainEqual(
      expect.objectContaining({ currency: "USD", upcomingAmount: "29.97" }),
    );
    expect(dashboard.data.categoryBreakdown[0]?.subscriptionCount).toBe(1);
  });

  it("detaches a deleted category without deleting the subscription", async () => {
    const category = await post<{ id: string }>("/api/v1/categories", {
      name: "Utilities",
      color: "#0EA5E9",
      position: 0,
    });
    const subscription = await post<{ id: string }>("/api/v1/subscriptions", {
      name: "Hosting",
      amount: "5",
      currency: "USD",
      recurrence: {
        unit: "month",
        count: 1,
        anchorOn: "2026-08-23",
        anchorMode: "calendar_day",
      },
      categoryId: category.id,
      paymentMethodId: null,
      websiteUrl: null,
      notes: null,
    });
    const deleted = await api(`/api/v1/categories/${category.id}`, {
      method: "DELETE",
      headers: { Origin: ORIGIN },
    });
    expect(deleted.status).toBe(204);
    const response = await api(`/api/v1/subscriptions/${subscription.id}`);
    const body = await response.json<{ data: { categoryId: string | null } }>();
    expect(body.data.categoryId).toBeNull();
  });

  it("exports a deterministic private archive and previews it without writes", async () => {
    await post("/api/v1/categories", {
      name: "Utilities",
      color: "#0EA5E9",
      position: 0,
    });
    const exported = await api("/api/v1/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    const archive = await exported.json<Record<string, unknown>>();
    expect(archive.format).toBe("opensublists");
    expect(archive).not.toHaveProperty("userId");

    const preview = await post<{
      digest: string;
      conflicts: { categories: number };
    }>("/api/v1/imports/preview", { archive });
    expect(preview.digest).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(preview.conflicts.categories).toBe(1);
  });

  it("enforces tenant scope even when two users share the same resource id", async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (
           id, primary_email, email_normalized, timezone, reporting_currency, created_at, updated_at
         ) VALUES (?, ?, ?, 'UTC', 'USD', ?, ?)`,
      ).bind("user-a", "a@example.invalid", "a@example.invalid", now, now),
      env.DB.prepare(
        `INSERT INTO users (
           id, primary_email, email_normalized, timezone, reporting_currency, created_at, updated_at
         ) VALUES (?, ?, ?, 'UTC', 'USD', ?, ?)`,
      ).bind("user-b", "b@example.invalid", "b@example.invalid", now, now),
    ]);
    const repository = new D1OpenSubListsRepository(env.DB);
    const sharedId = "550e8400-e29b-41d4-a716-446655440000";
    await repository.createCategory("user-a", {
      id: sharedId,
      name: "A category",
      nameKey: "a category",
      color: "#111111",
      symbol: null,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createCategory("user-b", {
      id: sharedId,
      name: "B category",
      nameKey: "b category",
      color: "#222222",
      symbol: null,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });

    expect((await repository.getCategory("user-a", sharedId))?.name).toBe("A category");
    expect((await repository.getCategory("user-b", sharedId))?.name).toBe("B category");
    await repository.deleteCategory("user-a", sharedId);
    expect(await repository.getCategory("user-a", sharedId)).toBeNull();
    expect((await repository.getCategory("user-b", sharedId))?.name).toBe("B category");
  });

  it("uses the domain time-zone rule and keeps invalid aliases out of storage", async () => {
    await api("/api/v1/session");
    const response = await api("/api/v1/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ timezone: "GMT" }),
    });
    expect(response.status).toBe(422);
    const body = await response.json<{
      error: { code: string; details?: Array<{ code: string }> };
    }>();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toContainEqual(
      expect.objectContaining({ code: "INVALID_TIMEZONE" }),
    );
    const timezone = await env.DB.prepare("SELECT timezone FROM users").first<string>("timezone");
    expect(timezone).toBe("UTC");
  });

  it("atomically reconciles every subscription at the account limit", async () => {
    const sessionResponse = await api("/api/v1/session");
    const session = await sessionResponse.json<{ data: { user: { id: string } } }>();
    const userId = session.data.user.id;
    await seedSubscriptions(userId, 50, "2020-01-01");

    const response = await api("/api/v1/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ timezone: "Pacific/Kiritimati" }),
    });
    expect(response.status).toBe(200);
    const reconciled = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ? AND updated_at > 1",
    )
      .bind(userId)
      .first<number>("count");
    expect(reconciled).toBe(50);
    const timezone = await env.DB.prepare("SELECT timezone FROM users WHERE id = ?")
      .bind(userId)
      .first<string>("timezone");
    expect(timezone).toBe("Pacific/Kiritimati");
  });

  it("bounds dashboard work while preserving every occurrence at the maximum", async () => {
    const sessionResponse = await api("/api/v1/session");
    const session = await sessionResponse.json<{ data: { user: { id: string } } }>();
    await seedSubscriptions(session.data.user.id, 50, "2099-01-01");

    const rejected = await api("/api/v1/dashboard?upcomingDays=31");
    expect(rejected.status).toBe(422);

    const response = await api("/api/v1/dashboard?upcomingDays=30");
    expect(response.status).toBe(200);
    const body = await response.json<{
      data: { upcoming: Array<{ subscriptionId: string }> };
    }>();
    expect(body.data.upcoming).toHaveLength(1_500);
    expect(new Set(body.data.upcoming.map((occurrence) => occurrence.subscriptionId)).size).toBe(
      50,
    );
  });

  it("imports a complete max-size archive with bounded bulk statements", async () => {
    await api("/api/v1/session");
    const archive = archiveWithSubscriptions(50);
    const preview = await post<{ digest: string }>("/api/v1/imports/preview", { archive });
    const result = await post<{ created: { subscriptions: number } }>("/api/v1/imports", {
      archive,
      expectedDigest: preview.digest,
      conflictStrategy: "skip",
      importProfile: false,
      confirmed: true,
    });
    expect(result.created.subscriptions).toBe(50);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM subscriptions").first<number>(
      "count",
    );
    expect(count).toBe(50);
  });

  it("validates every imported subscription currency during preview", async () => {
    await api("/api/v1/session");
    const archive = archiveWithSubscriptions(1);
    const subscription = archive.subscriptions[0];
    if (subscription === undefined)
      throw new Error("The test archive is missing its subscription.");
    subscription.currency = "ZZZ";
    const response = await api("/api/v1/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ archive }),
    });
    expect(response.status).toBe(422);
    const body = await response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("enforces resource caps for both CRUD and confirmed imports", async () => {
    const sessionResponse = await api("/api/v1/session");
    const session = await sessionResponse.json<{ data: { user: { id: string } } }>();
    const userId = session.data.user.id;
    await seedCategories(userId, 100);

    const createResponse = await api("/api/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ name: "One too many", color: "#123456", position: 101 }),
    });
    expect(createResponse.status).toBe(409);

    const timestamp = new Date().toISOString();
    const archive = {
      ...archiveWithSubscriptions(0),
      categories: [
        {
          id: crypto.randomUUID(),
          name: "Imported overflow",
          color: "#654321",
          symbol: null,
          position: 102,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
    const preview = await post<{ digest: string }>("/api/v1/imports/preview", { archive });
    const importResponse = await api("/api/v1/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({
        archive,
        expectedDigest: preview.digest,
        conflictStrategy: "skip",
        importProfile: false,
        confirmed: true,
      }),
    });
    expect(importResponse.status).toBe(409);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM categories").first<number>(
      "count",
    );
    expect(count).toBe(100);
  });

  it("maps an import cap race to a conflict while the database preserves the cap", async () => {
    const sessionResponse = await api("/api/v1/session");
    const session = await sessionResponse.json<{ data: { user: { id: string } } }>();
    const userId = session.data.user.id;
    await seedCategories(userId, 99);

    const timestamp = new Date().toISOString();
    const archive = {
      ...archiveWithSubscriptions(0),
      categories: [
        {
          id: crypto.randomUUID(),
          name: "Imported during race",
          color: "#654321",
          symbol: null,
          position: 100,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
    const repository = new D1OpenSubListsRepository(env.DB);
    const preview = await new OpenSubListsService(repository).previewImport(userId, archive);
    let raceInserted = false;
    class RacingRepository extends D1OpenSubListsRepository {
      override async getImportState(targetUserId: string) {
        const staleState = await super.getImportState(targetUserId);
        if (!raceInserted) {
          raceInserted = true;
          await repository.createCategory(targetUserId, {
            id: crypto.randomUUID(),
            name: "Concurrent category",
            nameKey: "concurrent category",
            color: "#123456",
            symbol: null,
            position: 99,
            createdAt: 1,
            updatedAt: 1,
          });
        }
        return staleState;
      }
    }
    const racingRepository = new RacingRepository(env.DB);
    const request = importRequestSchema.parse({
      archive,
      expectedDigest: preview.digest,
      conflictStrategy: "skip",
      importProfile: false,
      confirmed: true,
    });
    await expect(
      new OpenSubListsService(racingRepository).importArchive(userId, request),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM categories").first<number>(
      "count",
    );
    expect(count).toBe(100);
  });

  it("returns every subscription at the enforced per-user cap", async () => {
    const sessionResponse = await api("/api/v1/session");
    const session = await sessionResponse.json<{ data: { user: { id: string } } }>();
    await seedSubscriptions(session.data.user.id, 50, "2099-01-01");
    const repository = new D1OpenSubListsRepository(env.DB);
    expect(await repository.listAllSubscriptions(session.data.user.id)).toHaveLength(50);
  });
});

async function seedCategories(userId: string, count: number): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE sequence(value) AS (
       SELECT 1
       UNION ALL
       SELECT value + 1 FROM sequence WHERE value < ?
     )
     INSERT INTO categories (
       user_id, id, name, name_key, color, position, created_at, updated_at
     )
     SELECT ?,
            printf('10000000-0000-4000-8000-%012d', value),
            printf('Seed category %d', value),
            printf('seed category %d', value),
            '#123456', value, 1, 1
     FROM sequence`,
  )
    .bind(count, userId)
    .run();
}

async function seedSubscriptions(
  userId: string,
  count: number,
  nextBillingOn: string,
): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE sequence(value) AS (
       SELECT 1
       UNION ALL
       SELECT value + 1 FROM sequence WHERE value < ?
     )
     INSERT INTO subscriptions (
       user_id, id, name, amount_micros, currency, recurrence_unit,
       recurrence_count, billing_anchor_on, anchor_mode, next_billing_on,
       status, cancelled_at, archived_at, category_id, payment_method_id,
       website_url, notes, created_at, updated_at
     )
     SELECT ?,
            printf('20000000-0000-4000-8000-%012d', value),
            printf('Seed subscription %d', value),
            1000000, 'USD', 'day', 1, '2020-01-01', 'calendar_day', ?,
            'active', NULL, NULL, NULL, NULL, NULL, NULL, 1, 1
     FROM sequence`,
  )
    .bind(count, userId, nextBillingOn)
    .run();
}

function archiveWithSubscriptions(count: number) {
  const timestamp = new Date().toISOString();
  return {
    format: "opensublists",
    schemaVersion: 2,
    archiveId: crypto.randomUUID(),
    exportedAt: timestamp,
    generator: { name: "OpenSubLists", version: "integration-test" },
    profile: { displayName: null, timezone: "UTC", reportingCurrency: "USD" },
    categories: [],
    paymentMethods: [],
    subscriptions: Array.from({ length: count }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `Imported subscription ${index + 1}`,
      symbol: null,
      amount: "1.25",
      currency: "USD",
      recurrence: {
        unit: "day",
        count: 1,
        anchorOn: "2020-01-01",
        anchorMode: "calendar_day",
      },
      status: "active",
      cancelledAt: null,
      archivedAt: null,
      categoryId: null,
      paymentMethodId: null,
      websiteUrl: null,
      notes: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  };
}

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await api(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  const envelope = await response.json<{ data: T }>();
  return envelope.data;
}

function api(path: string, init?: RequestInit): Promise<Response> {
  const request = new IncomingRequest(`http://localhost:5173${path}`, init);
  return Promise.resolve(worker.fetch(request, env, createExecutionContext()));
}

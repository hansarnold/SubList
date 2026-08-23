import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext } from "cloudflare:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { createApp } from "../../src/worker/api/app";
import { authenticateRequest, type AuthenticationEnvironment } from "../../src/worker/auth/access";

const migrations = inject("migrations");
const IncomingRequest = Request;
const ORIGIN = "http://localhost:5173";
const ACCESS_ISSUER = "https://test.cloudflareaccess.com";
const ACCESS_AUDIENCE = "test-access-audience";
const REMOTE_AUTH_ENV: AuthenticationEnvironment = {
  ENVIRONMENT: "preview",
  PUBLIC_ORIGIN: "https://app.example.com",
  TEAM_DOMAIN: "test.cloudflareaccess.com",
  POLICY_AUD: ACCESS_AUDIENCE,
};

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let untrustedSigningKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let verificationKeySet: JWTVerifyGetKey;

const remoteApp = createApp((request) =>
  authenticateRequest(request, REMOTE_AUTH_ENV, {
    getRemoteKeySet: () => verificationKeySet,
  }),
);

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  const trustedPair = await generateKeyPair("RS256", { extractable: true });
  const untrustedPair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(trustedPair.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = "test-access-key";
  publicJwk.use = "sig";
  signingKey = trustedPair.privateKey;
  untrustedSigningKey = untrustedPair.privateKey;
  verificationKeySet = createLocalJWKSet({ keys: [publicJwk] });
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users").run();
});

describe("Cloudflare Access authentication", () => {
  it("accepts the bracketed IPv6 loopback host in local development", async () => {
    await expect(
      authenticateRequest(new IncomingRequest("http://[::1]:8787/api/v1/session"), {
        ENVIRONMENT: "local",
        PUBLIC_ORIGIN: "http://[::1]:5173",
        TEAM_DOMAIN: "local.invalid",
        POLICY_AUD: "local-development",
      }),
    ).resolves.toEqual({
      provider: "local_development",
      subject: "local-user",
      email: "developer@localhost.invalid",
    });
  });

  it("accepts a signed application token and derives the server-side identity", async () => {
    let requestedKeySetUrl = "";
    const identity = await authenticateRequest(
      new IncomingRequest("https://app.example.com/api/v1/session", {
        headers: { "Cf-Access-Jwt-Assertion": await accessToken() },
      }),
      REMOTE_AUTH_ENV,
      {
        getRemoteKeySet: (url) => {
          requestedKeySetUrl = url;
          return verificationKeySet;
        },
      },
    );

    expect(requestedKeySetUrl).toBe(`${ACCESS_ISSUER}/cdn-cgi/access/certs`);
    expect(identity).toEqual({
      provider: "cloudflare_access",
      subject: "tenant-a",
      email: "tenant-a@example.invalid",
    });
  });

  it("rejects a missing Access assertion before provisioning a user", async () => {
    const response = await remoteRequest("/api/v1/session");

    await expectUnauthenticated(response);
    expect(await userCount()).toBe(0);
  });

  it("rejects invalid, expired, mis-scoped, non-app, and incomplete tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      {
        name: "invalid signature",
        token: await accessToken({ key: untrustedSigningKey }),
      },
      {
        name: "expired",
        token: await accessToken({ issuedAt: now - 120, notBefore: now - 120, expiresAt: now - 1 }),
      },
      {
        name: "wrong issuer",
        token: await accessToken({ issuer: "https://other.cloudflareaccess.com" }),
      },
      {
        name: "wrong audience",
        token: await accessToken({ audience: "another-application" }),
      },
      {
        name: "non-app token",
        token: await accessToken({ type: "org" }),
      },
      {
        name: "missing identity claims",
        token: await accessToken({ subject: null, email: null }),
      },
    ];

    for (const testCase of cases) {
      const response = await remoteRequest("/api/v1/session", testCase.token);
      await expectUnauthenticated(response, testCase.name);
    }
    expect(await userCount()).toBe(0);
  });

  it("audits verified-email identity relinking without identity claims or JWTs", async () => {
    const email = "stable-mailbox@example.invalid";
    const originalSubject = "original-access-subject";
    const replacementSubject = "replacement-access-subject";
    const originalToken = await accessToken({ subject: originalSubject, email });
    const replacementToken = await accessToken({ subject: replacementSubject, email });
    const auditLog = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const firstSession = await responseData<{ user: { id: string } }>(
        await remoteRequest("/api/v1/session", originalToken),
      );
      expect(auditLog).not.toHaveBeenCalled();

      const relinkedSession = await responseData<{ user: { id: string } }>(
        await remoteRequest("/api/v1/session", replacementToken),
      );
      expect(relinkedSession.user.id).toBe(firstSession.user.id);
      expect(await userCount()).toBe(1);
      expect(await identityCount()).toBe(2);

      await responseData(await remoteRequest("/api/v1/session", replacementToken));
      expect(auditLog).toHaveBeenCalledTimes(1);
      const serializedEvent = String(auditLog.mock.calls[0]?.[0]);
      expect(JSON.parse(serializedEvent)).toEqual({
        message: "security_audit",
        eventCode: "AUTH_IDENTITY_RELINKED",
        userId: firstSession.user.id,
        provider: "cloudflare_access",
      });
      for (const privateValue of [
        email,
        originalSubject,
        replacementSubject,
        originalToken,
        replacementToken,
      ]) {
        expect(serializedEvent).not.toContain(privateValue);
      }
    } finally {
      auditLog.mockRestore();
    }
  });
});

describe("HTTP tenant isolation", () => {
  it("keeps CRUD, lifecycle, and import data inside the authenticated Access tenant", async () => {
    const category = await remotePost<{ id: string }>("tenant-a", "/api/v1/categories", {
      name: "Tenant A category",
      color: "#123456",
      position: 0,
    });
    const paymentMethod = await remotePost<{ id: string }>("tenant-a", "/api/v1/payment-methods", {
      name: "Tenant A card",
      kind: "card",
      label: "•••• 1234",
      position: 0,
    });
    const subscription = await remotePost<{ id: string }>("tenant-a", "/api/v1/subscriptions", {
      name: "Tenant A subscription",
      amount: "12.50",
      currency: "USD",
      recurrence: {
        unit: "month",
        count: 1,
        anchorOn: "2026-08-23",
        anchorMode: "calendar_day",
      },
      categoryId: category.id,
      paymentMethodId: paymentMethod.id,
      websiteUrl: null,
      notes: null,
    });
    const exportedResponse = await tenantRequest("tenant-a", "/api/v1/export");
    expect(exportedResponse.status).toBe(200);
    const archive = await exportedResponse.json<Record<string, unknown>>();

    const tenantBSession = await tenantRequest("tenant-b", "/api/v1/session");
    expect(tenantBSession.status).toBe(200);
    await expectListLength("tenant-b", "/api/v1/categories", 0);
    await expectListLength("tenant-b", "/api/v1/payment-methods", 0);
    await expectListLength("tenant-b", "/api/v1/subscriptions", 0);

    await expectNotFound(
      tenantRequest("tenant-b", `/api/v1/categories/${category.id}`, {
        method: "PATCH",
        headers: jsonMutationHeaders(),
        body: JSON.stringify({ name: "Cross-tenant category update" }),
      }),
    );
    await expectNotFound(
      tenantRequest("tenant-b", `/api/v1/categories/${category.id}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN },
      }),
    );
    await expectNotFound(
      tenantRequest("tenant-b", `/api/v1/payment-methods/${paymentMethod.id}`, {
        method: "PATCH",
        headers: jsonMutationHeaders(),
        body: JSON.stringify({ name: "Cross-tenant payment update" }),
      }),
    );
    await expectNotFound(
      tenantRequest("tenant-b", `/api/v1/payment-methods/${paymentMethod.id}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN },
      }),
    );
    await expectNotFound(tenantRequest("tenant-b", `/api/v1/subscriptions/${subscription.id}`));
    await expectNotFound(
      tenantRequest("tenant-b", `/api/v1/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: jsonMutationHeaders(),
        body: JSON.stringify({ name: "Cross-tenant subscription update" }),
      }),
    );
    for (const action of ["cancel", "reactivate", "archive", "unarchive"]) {
      await expectNotFound(
        tenantRequest("tenant-b", `/api/v1/subscriptions/${subscription.id}/${action}`, {
          method: "POST",
          headers: { Origin: ORIGIN },
        }),
      );
    }
    await expectNotFound(
      tenantRequest("tenant-b", `/api/v1/subscriptions/${subscription.id}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN },
      }),
    );

    const foreignRelationship = await tenantRequest("tenant-b", "/api/v1/subscriptions", {
      method: "POST",
      headers: jsonMutationHeaders(),
      body: JSON.stringify({
        name: "Cross-tenant relationship",
        amount: "1.00",
        currency: "USD",
        recurrence: {
          unit: "month",
          count: 1,
          anchorOn: "2026-08-23",
          anchorMode: "calendar_day",
        },
        categoryId: category.id,
        paymentMethodId: paymentMethod.id,
        websiteUrl: null,
        notes: null,
      }),
    });
    expect(foreignRelationship.status).toBe(422);

    const preview = await remotePost<{
      digest: string;
      conflicts: { categories: number; paymentMethods: number; subscriptions: number };
    }>("tenant-b", "/api/v1/imports/preview", { archive });
    expect(preview.conflicts).toEqual({ categories: 0, paymentMethods: 0, subscriptions: 0 });
    const imported = await remotePost<{
      created: { categories: number; paymentMethods: number; subscriptions: number };
    }>("tenant-b", "/api/v1/imports", {
      archive,
      expectedDigest: preview.digest,
      conflictStrategy: "skip",
      importProfile: false,
      confirmed: true,
    });
    expect(imported.created).toEqual({ categories: 1, paymentMethods: 1, subscriptions: 1 });

    const renamedCategory = await remotePatch<{ name: string }>(
      "tenant-b",
      `/api/v1/categories/${category.id}`,
      { name: "Tenant B category" },
    );
    const renamedPayment = await remotePatch<{ name: string }>(
      "tenant-b",
      `/api/v1/payment-methods/${paymentMethod.id}`,
      { name: "Tenant B card" },
    );
    expect(renamedCategory.name).toBe("Tenant B category");
    expect(renamedPayment.name).toBe("Tenant B card");

    await expectLifecycleStatus("tenant-b", subscription.id, "cancel", "cancelled", false);
    await expectLifecycleStatus("tenant-b", subscription.id, "reactivate", "active", false);
    await expectLifecycleStatus("tenant-b", subscription.id, "archive", "active", true);
    await expectLifecycleStatus("tenant-b", subscription.id, "unarchive", "active", false);

    const tenantASubscription = await responseData<{
      status: string;
      archivedAt: string | null;
      name: string;
    }>(await tenantRequest("tenant-a", `/api/v1/subscriptions/${subscription.id}`));
    expect(tenantASubscription).toMatchObject({
      status: "active",
      archivedAt: null,
      name: "Tenant A subscription",
    });
    expect(await namedResource("tenant-a", "/api/v1/categories", category.id)).toBe(
      "Tenant A category",
    );
    expect(await namedResource("tenant-a", "/api/v1/payment-methods", paymentMethod.id)).toBe(
      "Tenant A card",
    );

    for (const path of [
      `/api/v1/categories/${category.id}`,
      `/api/v1/payment-methods/${paymentMethod.id}`,
      `/api/v1/subscriptions/${subscription.id}`,
    ]) {
      const response = await tenantRequest("tenant-b", path, {
        method: "DELETE",
        headers: { Origin: ORIGIN },
      });
      expect(response.status).toBe(204);
    }
    expect(
      (await tenantRequest("tenant-a", `/api/v1/subscriptions/${subscription.id}`)).status,
    ).toBe(200);
    expect(await namedResource("tenant-a", "/api/v1/categories", category.id)).toBe(
      "Tenant A category",
    );
    expect(await namedResource("tenant-a", "/api/v1/payment-methods", paymentMethod.id)).toBe(
      "Tenant A card",
    );
  });
});

type AccessTokenOverrides = {
  subject?: string | null;
  email?: string | null;
  issuer?: string;
  audience?: string;
  type?: string;
  issuedAt?: number;
  notBefore?: number;
  expiresAt?: number;
  key?: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
};

async function accessToken(overrides: AccessTokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const email = overrides.email === undefined ? "tenant-a@example.invalid" : overrides.email;
  let token = new SignJWT({
    ...(email === null ? {} : { email }),
    type: overrides.type ?? "app",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-access-key" })
    .setIssuer(overrides.issuer ?? ACCESS_ISSUER)
    .setAudience(overrides.audience ?? ACCESS_AUDIENCE)
    .setIssuedAt(overrides.issuedAt ?? now - 5)
    .setNotBefore(overrides.notBefore ?? now - 5)
    .setExpirationTime(overrides.expiresAt ?? now + 300);
  const subject = overrides.subject === undefined ? "tenant-a" : overrides.subject;
  if (subject !== null) token = token.setSubject(subject);
  return token.sign(overrides.key ?? signingKey);
}

function remoteRequest(path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token !== undefined) headers.set("Cf-Access-Jwt-Assertion", token);
  const request = new IncomingRequest(`${ORIGIN}${path}`, { ...init, headers });
  return Promise.resolve(remoteApp.fetch(request, env, createExecutionContext()));
}

async function tenantRequest(
  subject: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return remoteRequest(
    path,
    await accessToken({ subject, email: `${subject}@example.invalid` }),
    init,
  );
}

async function remotePost<T>(subject: string, path: string, body: unknown): Promise<T> {
  return responseData<T>(
    await tenantRequest(subject, path, {
      method: "POST",
      headers: jsonMutationHeaders(),
      body: JSON.stringify(body),
    }),
  );
}

async function remotePatch<T>(subject: string, path: string, body: unknown): Promise<T> {
  return responseData<T>(
    await tenantRequest(subject, path, {
      method: "PATCH",
      headers: jsonMutationHeaders(),
      body: JSON.stringify(body),
    }),
  );
}

function jsonMutationHeaders(): HeadersInit {
  return { "Content-Type": "application/json", Origin: ORIGIN };
}

async function responseData<T>(response: Response): Promise<T> {
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return (await response.json<{ data: T }>()).data;
}

async function expectUnauthenticated(response: Response, caseName = "request"): Promise<void> {
  expect(response.status, caseName).toBe(401);
  expect(response.headers.get("Cache-Control"), caseName).toBe("private, no-store");
  const body = await response.json<{ error: { code: string } }>();
  expect(body.error.code, caseName).toBe("UNAUTHENTICATED");
}

async function expectNotFound(responsePromise: Promise<Response>): Promise<void> {
  const response = await responsePromise;
  expect(response.status).toBe(404);
  const body = await response.json<{ error: { code: string } }>();
  expect(body.error.code).toBe("NOT_FOUND");
}

async function expectListLength(subject: string, path: string, length: number): Promise<void> {
  const response = await tenantRequest(subject, path);
  const body = await response.json<{ data: unknown[] }>();
  expect(response.status).toBe(200);
  expect(body.data).toHaveLength(length);
}

async function namedResource(
  subject: string,
  path: string,
  id: string,
): Promise<string | undefined> {
  const response = await tenantRequest(subject, path);
  const body = await response.json<{ data: Array<{ id: string; name: string }> }>();
  expect(response.status).toBe(200);
  return body.data.find((item) => item.id === id)?.name;
}

async function expectLifecycleStatus(
  subject: string,
  subscriptionId: string,
  action: string,
  status: string,
  archived: boolean,
): Promise<void> {
  const data = await responseData<{ status: string; archivedAt: string | null }>(
    await tenantRequest(subject, `/api/v1/subscriptions/${subscriptionId}/${action}`, {
      method: "POST",
      headers: { Origin: ORIGIN },
    }),
  );
  expect(data.status).toBe(status);
  expect(data.archivedAt === null).toBe(!archived);
}

async function userCount(): Promise<number | null> {
  return env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<number>("count");
}

async function identityCount(): Promise<number | null> {
  return env.DB.prepare("SELECT COUNT(*) AS count FROM auth_identities").first<number>("count");
}

import { Hono, type Context, type Input } from "hono";
import { routePath } from "hono/route";
import { z } from "zod";
import { ApplicationError } from "../../application/errors";
import { ExchangeRateRefreshService } from "../../application/fx-service";
import type { AppUser } from "../../application/models";
import { OpenSubListsService, toApiUser } from "../../application/service";
import { DomainValidationError, assertCurrencyCode } from "../../domain";
import type { ApiError, Session } from "../../shared/api-types";
import {
  completeOnboardingSchema,
  createCategoriesBatchSchema,
  createCategorySchema,
  createPaymentMethodSchema,
  createSubscriptionSchema,
  importPreviewRequestSchema,
  importRequestSchema,
  updateCategorySchema,
  updatePaymentMethodSchema,
  updateSubscriptionSchema,
  updateUserSchema,
  uuidSchema,
} from "../../shared/api-types/schemas";
import { authenticateRequest } from "../auth/access";
import { D1OpenSubListsRepository } from "../db/repository";
import { EcbExchangeRateProvider } from "../fx/ecb";
import { resolveEmailReminderRuntime, type EmailReminderRuntime } from "../email/config";
import { CRUD_BODY_LIMIT, IMPORT_BODY_LIMIT, parseJsonBody } from "./http";

type Variables = {
  errorCode: string | null;
  requestId: string;
  user: AppUser;
  service: OpenSubListsService;
};

type AppHono = { Bindings: Env; Variables: Variables };

const applicationEnvironmentSchema = z.enum(["local", "preview", "production"]);

export type RequestAuthenticator = (
  request: Request,
  env: Env,
) => ReturnType<typeof authenticateRequest>;

export type EmailReminderRuntimeResolver = (env: Env) => EmailReminderRuntime;

export function createApp(
  authenticator: RequestAuthenticator = authenticateRequest,
  emailRuntimeResolver: EmailReminderRuntimeResolver = resolveEmailReminderRuntime,
): Hono<AppHono> {
  const app = new Hono<AppHono>();

  app.use("*", async (context, next) => {
    const requestId = context.req.header("Cf-Ray") ?? crypto.randomUUID();
    context.set("errorCode", null);
    context.set("requestId", requestId);
    const startedAt = performance.now();
    await next();
    if (context.req.path.startsWith("/api/")) {
      context.header("Cache-Control", "private, no-store");
      context.header("X-Request-Id", requestId);
    }
    console.log(
      JSON.stringify({
        message: "request_complete",
        environment: context.env.ENVIRONMENT,
        requestId,
        method: context.req.method,
        routeTemplate: requestRouteTemplate(context),
        status: context.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        errorCode: context.get("errorCode"),
      }),
    );
  });

  app.get("/health", (context) => context.json({ status: "ok" }));

  app.use("/api/v1/*", async (context, next) => {
    enforceSameOrigin(context.req.method, context.req.header("Origin"), context.env.PUBLIC_ORIGIN);
    const repository = new D1OpenSubListsRepository(context.env.DB);
    const exchangeRates = new ExchangeRateRefreshService(repository, new EcbExchangeRateProvider());
    const emailRuntime = emailRuntimeResolver(context.env);
    const service = new OpenSubListsService(
      repository,
      Date.now,
      async () => (await exchangeRates.refresh()).snapshot,
      {
        emailRemindersAvailable: emailRuntime.available,
        reminderStore: repository,
      },
    );
    const identity = await authenticator(context.req.raw, context.env);
    context.set("service", service);
    context.set("user", await service.resolveUser(identity));
    await next();
  });

  app.get("/api/v1/session", (context) => {
    const data: Session = {
      user: toApiUser(context.get("user")),
      environment: applicationEnvironmentSchema.parse(context.env.ENVIRONMENT),
      capabilities: {
        emailReminders: emailRuntimeResolver(context.env).available,
      },
    };
    return context.json({ data });
  });

  app.get("/api/v1/me", async (context) =>
    context.json({ data: await service(context).getMe(userId(context)) }),
  );

  app.patch("/api/v1/me", async (context) =>
    context.json({
      data: await service(context).updateMe(
        userId(context),
        await parseJsonBody(context, updateUserSchema, CRUD_BODY_LIMIT),
      ),
    }),
  );

  app.post("/api/v1/onboarding/complete", async (context) => {
    await parseOptionalEmptyJsonBody(context, completeOnboardingSchema);
    return context.json({ data: await service(context).completeOnboarding(userId(context)) });
  });

  app.get("/api/v1/categories", async (context) => {
    const data = await service(context).listCategories(userId(context));
    return context.json({ data, meta: { count: data.length } });
  });

  app.post("/api/v1/categories", async (context) =>
    context.json(
      {
        data: await service(context).createCategory(
          userId(context),
          await parseJsonBody(context, createCategorySchema),
        ),
      },
      201,
    ),
  );

  app.post("/api/v1/categories/batch", async (context) =>
    context.json(
      {
        data: await service(context).createCategories(
          userId(context),
          await parseJsonBody(context, createCategoriesBatchSchema),
        ),
      },
      201,
    ),
  );

  app.patch("/api/v1/categories/:id", async (context) =>
    context.json({
      data: await service(context).updateCategory(
        userId(context),
        resourceId(context),
        await parseJsonBody(context, updateCategorySchema),
      ),
    }),
  );

  app.delete("/api/v1/categories/:id", async (context) => {
    await service(context).deleteCategory(userId(context), resourceId(context));
    return context.body(null, 204);
  });

  app.get("/api/v1/payment-methods", async (context) => {
    const data = await service(context).listPaymentMethods(userId(context));
    return context.json({ data, meta: { count: data.length } });
  });

  app.post("/api/v1/payment-methods", async (context) =>
    context.json(
      {
        data: await service(context).createPaymentMethod(
          userId(context),
          await parseJsonBody(context, createPaymentMethodSchema),
        ),
      },
      201,
    ),
  );

  app.patch("/api/v1/payment-methods/:id", async (context) =>
    context.json({
      data: await service(context).updatePaymentMethod(
        userId(context),
        resourceId(context),
        await parseJsonBody(context, updatePaymentMethodSchema),
      ),
    }),
  );

  app.delete("/api/v1/payment-methods/:id", async (context) => {
    await service(context).deletePaymentMethod(userId(context), resourceId(context));
    return context.body(null, 204);
  });

  app.get("/api/v1/subscriptions", async (context) => {
    const filter = parseSubscriptionFilter(context);
    const data = await service(context).listSubscriptions(userId(context), filter);
    return context.json({ data, meta: { count: data.length } });
  });

  app.post("/api/v1/subscriptions", async (context) =>
    context.json(
      {
        data: await service(context).createSubscription(
          userId(context),
          await parseJsonBody(context, createSubscriptionSchema),
        ),
      },
      201,
    ),
  );

  app.get("/api/v1/subscriptions/:id", async (context) =>
    context.json({
      data: await service(context).getSubscription(userId(context), resourceId(context)),
    }),
  );

  app.patch("/api/v1/subscriptions/:id", async (context) =>
    context.json({
      data: await service(context).updateSubscription(
        userId(context),
        resourceId(context),
        await parseJsonBody(context, updateSubscriptionSchema),
      ),
    }),
  );

  for (const [action, method] of [
    ["cancel", "cancelSubscription"],
    ["reactivate", "reactivateSubscription"],
    ["archive", "archiveSubscription"],
    ["unarchive", "unarchiveSubscription"],
  ] as const) {
    app.post(`/api/v1/subscriptions/:id/${action}`, async (context) =>
      context.json({
        data: await service(context)[method](userId(context), resourceId(context)),
      }),
    );
  }

  app.delete("/api/v1/subscriptions/:id", async (context) => {
    await service(context).deleteSubscription(userId(context), resourceId(context));
    return context.body(null, 204);
  });

  app.get("/api/v1/dashboard", async (context) => {
    const raw = context.req.query("upcomingDays") ?? "30";
    if (!/^\d{1,3}$/.test(raw)) throw invalidQuery("upcomingDays");
    const upcomingDays = Number(raw);
    if (upcomingDays < 1 || upcomingDays > 30) throw invalidQuery("upcomingDays");
    return context.json({
      data: await service(context).getDashboard(userId(context), upcomingDays),
    });
  });

  app.get("/api/v1/export", async (context) => {
    const archive = await service(context).exportArchive(userId(context));
    const response = context.json(archive);
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="opensublists-backup-${archive.exportedAt.slice(0, 10)}.json"`,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });

  app.post("/api/v1/imports/preview", async (context) => {
    const input = await parseJsonBody(
      context,
      importPreviewRequestSchema,
      IMPORT_BODY_LIMIT,
      assertSupportedArchiveVersion,
    );
    return context.json({
      data: await service(context).previewImport(userId(context), input),
    });
  });

  app.post("/api/v1/imports", async (context) => {
    const input = await parseJsonBody(
      context,
      importRequestSchema,
      IMPORT_BODY_LIMIT,
      assertSupportedArchiveVersion,
    );
    return context.json({ data: await service(context).importArchive(userId(context), input) });
  });

  app.notFound((context) =>
    errorResponse(context, new ApplicationError("NOT_FOUND", "Route not found.", 404)),
  );

  app.onError((error, context) => {
    if (error instanceof ApplicationError) return errorResponse(context, error);
    if (error instanceof DomainValidationError) {
      return errorResponse(
        context,
        new ApplicationError("VALIDATION_ERROR", "The request contains invalid fields.", 422, [
          {
            path: error.path ?? "",
            code: error.code,
            message: error.message,
          },
        ]),
      );
    }
    console.error(
      JSON.stringify({
        message: "request_failed",
        environment: context.env.ENVIRONMENT,
        requestId: context.get("requestId"),
        method: context.req.method,
        routeTemplate: requestRouteTemplate(context),
        status: 500,
        errorCode: "INTERNAL_ERROR",
      }),
    );
    return errorResponse(
      context,
      new ApplicationError("INTERNAL_ERROR", "An unexpected error occurred.", 500),
    );
  });

  return app;
}

function service(context: Context<AppHono>): OpenSubListsService {
  return context.get("service");
}

function userId(context: Context<AppHono>): string {
  return context.get("user").id;
}

function resourceId(context: Context<AppHono>): string {
  const value = context.req.param("id");
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw new ApplicationError("NOT_FOUND", "Resource was not found.", 404);
  }
  return result.data;
}

function enforceSameOrigin(method: string, origin: string | undefined, publicOrigin: string): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
  if (origin !== publicOrigin) {
    throw new ApplicationError("INVALID_ORIGIN", "The request origin is not allowed.", 400);
  }
}

async function parseOptionalEmptyJsonBody(
  context: Context<AppHono>,
  schema: typeof completeOnboardingSchema,
): Promise<Record<string, never>> {
  if (context.req.raw.body === null) return schema.parse({});
  return parseJsonBody(context, schema);
}

function parseSubscriptionFilter(context: Context<AppHono>) {
  const querySchema = z.strictObject({
    q: z.string().max(120).optional(),
    status: z.enum(["active", "cancelled"]).optional(),
    archived: z.enum(["exclude", "only", "include"]).default("exclude"),
    categoryId: z.union([uuidSchema, z.literal("none")]).optional(),
    paymentMethodId: z.union([uuidSchema, z.literal("none")]).optional(),
    currency: z.string().optional(),
    sort: z.enum(["nextBillingOn", "name", "amount", "createdAt"]).default("nextBillingOn"),
    order: z.enum(["asc", "desc"]).default("asc"),
  });
  const parsed = querySchema.safeParse(context.req.query());
  if (!parsed.success) throw invalidQuery(parsed.error.issues[0]?.path.join(".") ?? "query");
  if (parsed.data.currency !== undefined) assertCurrencyCode(parsed.data.currency);
  const currencyFilters = new URL(context.req.url).searchParams.getAll("currency");
  if (parsed.data.sort === "amount" && currencyFilters.length !== 1) {
    throw new ApplicationError("VALIDATION_ERROR", "The query contains invalid fields.", 422, [
      {
        path: "sort",
        code: "AMOUNT_SORT_REQUIRES_CURRENCY",
        message: "Amount sorting requires exactly one currency filter.",
      },
    ]);
  }
  return {
    ...(parsed.data.q === undefined ? {} : { query: parsed.data.q }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    archived: parsed.data.archived,
    ...(parsed.data.categoryId === undefined
      ? {}
      : { categoryId: parsed.data.categoryId === "none" ? null : parsed.data.categoryId }),
    ...(parsed.data.paymentMethodId === undefined
      ? {}
      : {
          paymentMethodId:
            parsed.data.paymentMethodId === "none" ? null : parsed.data.paymentMethodId,
        }),
    ...(parsed.data.currency === undefined ? {} : { currency: parsed.data.currency }),
    sort: parsed.data.sort,
    order: parsed.data.order,
  };
}

function assertSupportedArchiveVersion(source: unknown): void {
  if (!isRecord(source) || !isRecord(source.archive)) return;
  const archive = source.archive;
  if (
    archive.format === "opensublists" &&
    typeof archive.schemaVersion === "number" &&
    Number.isInteger(archive.schemaVersion) &&
    archive.schemaVersion !== 3
  ) {
    throw new ApplicationError(
      "UNSUPPORTED_ARCHIVE_VERSION",
      "This OpenSubLists archive version is not supported.",
      422,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidQuery(path: string): ApplicationError {
  return new ApplicationError("VALIDATION_ERROR", "The query contains invalid fields.", 422, [
    { path, code: "INVALID_QUERY", message: "The query parameter is invalid." },
  ]);
}

function errorResponse(context: Context<AppHono>, error: ApplicationError): Response {
  const requestId = context.get("requestId") || crypto.randomUUID();
  context.set("errorCode", error.code);
  const body: ApiError = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    },
  };
  const response = context.json(body, error.status);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Request-Id", requestId);
  return response;
}

function requestRouteTemplate<Path extends string, RequestInput extends Input>(
  context: Context<AppHono, Path, RequestInput>,
): string {
  return routePath(context, -1) || "<unmatched>";
}

export default createApp();

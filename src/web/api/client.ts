import type {
  ApiErrorDetail,
  Category,
  Dashboard,
  ImportPreview,
  ImportResult,
  PaymentMethod,
  Session,
  Subscription,
  SubscriptionInput,
  User,
} from "./types";

type Envelope<T> = { data: T; meta?: { count: number } };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId: string | undefined;

  constructor(
    message: string,
    status: number,
    code = "UNKNOWN_ERROR",
    details: ApiErrorDetail[] = [],
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Unable to reach the server.", 0, "NETWORK_ERROR");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as
    | Envelope<T>
    | {
        error?: {
          message?: string;
          code?: string;
          details?: ApiErrorDetail[];
          requestId?: string;
        };
      }
    | null;

  if (!response.ok) {
    const error = payload && "error" in payload ? payload.error : undefined;
    throw new ApiError(
      error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      error?.code,
      error?.details,
      error?.requestId,
    );
  }

  if (!payload || !("data" in payload)) {
    throw new ApiError(
      "The server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return payload.data;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export const api = {
  session: () => request<Session>("/session"),
  me: () => request<User>("/me"),
  updateMe: (input: Partial<Pick<User, "displayName" | "timezone" | "defaultCurrency">>) =>
    request<User>("/me", { method: "PATCH", body: jsonBody(input) }),

  categories: () => request<Category[]>("/categories"),
  createCategory: (input: Pick<Category, "name" | "color" | "position">) =>
    request<Category>("/categories", { method: "POST", body: jsonBody(input) }),
  updateCategory: (id: string, input: Partial<Pick<Category, "name" | "color" | "position">>) =>
    request<Category>(`/categories/${id}`, { method: "PATCH", body: jsonBody(input) }),
  deleteCategory: (id: string) => request<void>(`/categories/${id}`, { method: "DELETE" }),

  paymentMethods: () => request<PaymentMethod[]>("/payment-methods"),
  createPaymentMethod: (input: Pick<PaymentMethod, "name" | "kind" | "label" | "position">) =>
    request<PaymentMethod>("/payment-methods", { method: "POST", body: jsonBody(input) }),
  updatePaymentMethod: (
    id: string,
    input: Partial<Pick<PaymentMethod, "name" | "kind" | "label" | "position">>,
  ) =>
    request<PaymentMethod>(`/payment-methods/${id}`, {
      method: "PATCH",
      body: jsonBody(input),
    }),
  deletePaymentMethod: (id: string) =>
    request<void>(`/payment-methods/${id}`, { method: "DELETE" }),

  subscriptions: (searchParams?: URLSearchParams) =>
    request<Subscription[]>(`/subscriptions${searchParams?.size ? `?${searchParams}` : ""}`),
  subscription: (id: string) => request<Subscription>(`/subscriptions/${id}`),
  createSubscription: (input: SubscriptionInput) =>
    request<Subscription>("/subscriptions", { method: "POST", body: jsonBody(input) }),
  updateSubscription: (id: string, input: Partial<SubscriptionInput>) =>
    request<Subscription>(`/subscriptions/${id}`, { method: "PATCH", body: jsonBody(input) }),
  subscriptionAction: (id: string, action: "cancel" | "reactivate" | "archive" | "unarchive") =>
    request<Subscription>(`/subscriptions/${id}/${action}`, { method: "POST" }),
  deleteSubscription: (id: string) => request<void>(`/subscriptions/${id}`, { method: "DELETE" }),

  dashboard: (upcomingDays: 7 | 30) =>
    request<Dashboard>(`/dashboard?upcomingDays=${upcomingDays}`),

  previewImport: (archive: unknown) =>
    request<ImportPreview>("/imports/preview", {
      method: "POST",
      body: jsonBody({ archive }),
    }),
  confirmImport: (input: {
    archive: unknown;
    expectedDigest: string;
    conflictStrategy: "skip" | "overwrite" | "duplicate";
    importProfile: boolean;
    confirmed: true;
  }) => request<ImportResult>("/imports", { method: "POST", body: jsonBody(input) }),
};

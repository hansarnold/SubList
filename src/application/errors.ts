import type { ApiErrorDetail } from "../shared/api-types";

export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 413 | 422 | 500,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export function notFound(resource: string): ApplicationError {
  return new ApplicationError("NOT_FOUND", `${resource} was not found.`, 404);
}

export function conflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", message, 409);
}

export class IdentityEmailConflictError extends ApplicationError {
  constructor() {
    super(
      "IDENTITY_EMAIL_CONFLICT",
      "The verified identity email is already linked to another account.",
      409,
    );
    this.name = "IdentityEmailConflictError";
  }
}

export class ImportStateChangedError extends ApplicationError {
  constructor() {
    super(
      "IMPORT_STATE_CHANGED",
      "Account data changed while the import was being applied. Run preview again.",
      409,
    );
    this.name = "ImportStateChangedError";
  }
}

export class SubscriptionStateChangedError extends ApplicationError {
  constructor() {
    super(
      "SUBSCRIPTION_STATE_CHANGED",
      "The subscription changed while this update was being applied. Reload and try again.",
      409,
    );
    this.name = "SubscriptionStateChangedError";
  }
}

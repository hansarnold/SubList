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

export type DomainErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_DATE"
  | "INVALID_EXCHANGE_RATE"
  | "INVALID_RECURRENCE"
  | "MISSING_EXCHANGE_RATE"
  | "INVALID_TIMEZONE"
  | "INVALID_WINDOW"
  | "TOO_MANY_OCCURRENCES";

export class DomainValidationError extends Error {
  readonly code: DomainErrorCode;
  readonly path: string | undefined;

  constructor(code: DomainErrorCode, message: string, path?: string) {
    super(message);
    this.name = "DomainValidationError";
    this.code = code;
    this.path = path;
  }
}

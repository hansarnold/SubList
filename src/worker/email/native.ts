import type {
  EmailSender,
  ReminderEmailEnvelope,
  ReminderEmailSendOutcome,
} from "../../application/ports";

const PERMANENT_CODES = new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_TOO_MANY_ATTACHMENTS",
  "E_SENDER_NOT_VERIFIED",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_CONTENT_TOO_LARGE",
  "E_DELIVERY_FAILED",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
  "E_HEADER_VALUE_TOO_LONG",
  "E_HEADER_NAME_INVALID",
  "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY",
]);

export class CloudflareEmailSender implements EmailSender {
  constructor(
    private readonly binding: SendEmail,
    private readonly from: string,
  ) {}

  async send(envelope: ReminderEmailEnvelope): Promise<ReminderEmailSendOutcome> {
    try {
      const result = await this.binding.send({
        to: envelope.recipient,
        from: this.from,
        subject: envelope.subject,
        text: envelope.text,
        html: envelope.html,
      });
      return { kind: "accepted", providerMessageId: result.messageId || null };
    } catch (error) {
      const code = readCloudflareErrorCode(error);
      if (code !== null && PERMANENT_CODES.has(code)) {
        return { kind: "permanent", errorCode: stableCode(code) };
      }
      return {
        kind: "ambiguous",
        errorCode:
          code === "E_INTERNAL_SERVER_ERROR"
            ? "provider_internal_error"
            : code === "E_RATE_LIMIT_EXCEEDED" || code === "E_DAILY_LIMIT_EXCEEDED"
              ? "provider_rate_limited"
              : "provider_unknown",
      };
    }
  }
}

function readCloudflareErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function stableCode(value: string): string {
  return value.toLowerCase().replace(/^e_/, "provider_");
}

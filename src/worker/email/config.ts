import type { ReminderProviderConfiguration } from "../../application/ports";
import { defaultReminderProviderConfiguration } from "../../application/reminder-service";

export type EmailReminderRuntime =
  | { available: false }
  | {
      available: true;
      kind: "cloudflare";
      binding: SendEmail;
      from: string;
      configuration: ReminderProviderConfiguration;
    }
  | {
      available: true;
      kind: "fake";
      configuration: ReminderProviderConfiguration;
    };

export type EmailReminderEnv = Pick<
  Env,
  | "PUBLIC_ORIGIN"
  | "ENVIRONMENT"
  | "EMAIL_REMINDER_MODE"
  | "EMAIL_REMINDER_FROM"
  | "EMAIL_REMINDER_PROVIDER_CONFIG_REVISION"
> & { EMAIL?: SendEmail };

export function resolveEmailReminderRuntime(env: EmailReminderEnv): EmailReminderRuntime {
  const revision = parsePositiveInteger(env.EMAIL_REMINDER_PROVIDER_CONFIG_REVISION);
  if (revision === null) return { available: false };
  if (!isHttpOrigin(env.PUBLIC_ORIGIN)) return { available: false };

  if (
    env.EMAIL_REMINDER_MODE === "fake" &&
    (env.ENVIRONMENT === "local" || env.ENVIRONMENT === "preview")
  ) {
    return {
      available: true,
      kind: "fake",
      configuration: defaultReminderProviderConfiguration({
        providerKey: "deterministic_fake",
        providerConfigRevision: revision,
        appBaseUrl: env.PUBLIC_ORIGIN,
      }),
    };
  }

  if (env.ENVIRONMENT !== "production" || env.EMAIL_REMINDER_MODE !== "cloudflare") {
    return { available: false };
  }
  if (env.EMAIL === undefined) return { available: false };
  const from = env.EMAIL_REMINDER_FROM?.trim();
  if (from === undefined || !isProductionEmailAddress(from)) return { available: false };

  return {
    available: true,
    kind: "cloudflare",
    binding: env.EMAIL,
    from,
    configuration: defaultReminderProviderConfiguration({
      providerKey: "cloudflare_email_service",
      providerConfigRevision: revision,
      appBaseUrl: env.PUBLIC_ORIGIN,
    }),
  };
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isProductionEmailAddress(value: string): boolean {
  if (/[\r\n]/.test(value) || value.endsWith(".invalid")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

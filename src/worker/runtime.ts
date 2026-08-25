import type { ExchangeRateProvider } from "../application/fx-service";
import { ExchangeRateRefreshService } from "../application/fx-service";
import type { EmailSender } from "../application/ports";
import { RenewalReminderService } from "../application/reminder-service";
import app from "./api/app";
import { D1OpenSubListsRepository } from "./db/repository";
import { resolveEmailReminderRuntime, type EmailReminderRuntime } from "./email/config";
import { FakeEmailSender } from "./email/fake";
import { CloudflareEmailSender } from "./email/native";
import { EcbExchangeRateProvider, EcbProviderError } from "./fx/ecb";

type ExchangeRateProviderFactory = () => ExchangeRateProvider;
type AvailableEmailRuntime = Extract<EmailReminderRuntime, { available: true }>;

export const FX_REFRESH_CRON = "15 18 * * *";
export const RENEWAL_REMINDER_CRON = "5 * * * *";

export type WorkerReminderDependencies = {
  resolveEmailRuntime: (env: Env) => EmailReminderRuntime;
  createEmailSender: (runtime: AvailableEmailRuntime) => EmailSender;
  now: () => number;
};

export function createWorker(
  providerFactory: ExchangeRateProviderFactory = () => new EcbExchangeRateProvider(),
  reminderDependencies: WorkerReminderDependencies = {
    resolveEmailRuntime: resolveEmailReminderRuntime,
    createEmailSender: (runtime) =>
      runtime.kind === "fake"
        ? new FakeEmailSender()
        : new CloudflareEmailSender(runtime.binding, runtime.from),
    now: Date.now,
  },
) {
  return {
    fetch(request: Request, env: Env, context: ExecutionContext) {
      return app.fetch(request, env, context);
    },

    async scheduled(controller: ScheduledController, env: Env) {
      if (controller.cron === FX_REFRESH_CRON) {
        await runFxRefresh(controller, env, providerFactory, reminderDependencies.now);
        return;
      }
      if (controller.cron === RENEWAL_REMINDER_CRON) {
        await runRenewalReminders(controller, env, reminderDependencies);
        return;
      }
      console.warn(
        JSON.stringify({
          message: "scheduled_trigger_ignored",
          environment: env.ENVIRONMENT,
          cron: controller.cron,
        }),
      );
    },
  } satisfies ExportedHandler<Env>;
}

async function runFxRefresh(
  controller: ScheduledController,
  env: Env,
  providerFactory: ExchangeRateProviderFactory,
  now: () => number,
): Promise<void> {
  const startedAt = now();
  try {
    const repository = new D1OpenSubListsRepository(env.DB);
    const result = await new ExchangeRateRefreshService(repository, providerFactory()).refresh();
    console.log(
      JSON.stringify({
        message: "fx_refresh_complete",
        environment: env.ENVIRONMENT,
        provider: result.snapshot.provider,
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        outcome: result.outcome,
        rateDate: result.snapshot.rateDate,
        rateCount: result.snapshot.rates.length,
        durationMs: now() - startedAt,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "fx_refresh_failed",
        environment: env.ENVIRONMENT,
        provider: "ecb",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        errorCode: error instanceof EcbProviderError ? error.code : "FX_REFRESH_FAILED",
        durationMs: now() - startedAt,
      }),
    );
    throw error;
  }
}

async function runRenewalReminders(
  controller: ScheduledController,
  env: Env,
  dependencies: WorkerReminderDependencies,
): Promise<void> {
  const startedAt = dependencies.now();
  const runtime = dependencies.resolveEmailRuntime(env);
  if (!runtime.available) {
    console.log(
      JSON.stringify({
        message: "renewal_reminder_dispatch_skipped",
        environment: env.ENVIRONMENT,
        cron: controller.cron,
        reason: "sender_unavailable",
        durationMs: dependencies.now() - startedAt,
      }),
    );
    return;
  }

  try {
    const repository = new D1OpenSubListsRepository(env.DB);
    const result = await new RenewalReminderService(
      repository,
      dependencies.createEmailSender(runtime),
      runtime.configuration,
      dependencies.now,
    ).run(controller.scheduledTime);
    console.log(
      JSON.stringify({
        message: "renewal_reminder_dispatch_complete",
        environment: env.ENVIRONMENT,
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        ...result,
        durationMs: dependencies.now() - startedAt,
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        message: "renewal_reminder_dispatch_failed",
        environment: env.ENVIRONMENT,
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        errorCode: "RENEWAL_REMINDER_DISPATCH_FAILED",
        durationMs: dependencies.now() - startedAt,
      }),
    );
    throw new Error("Renewal reminder dispatch failed.");
  }
}

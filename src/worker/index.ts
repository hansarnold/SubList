import type { ExchangeRateProvider } from "../application/fx-service";
import { ExchangeRateRefreshService } from "../application/fx-service";
import app from "./api/app";
import { D1OpenSubListsRepository } from "./db/repository";
import { EcbExchangeRateProvider, EcbProviderError } from "./fx/ecb";

type ExchangeRateProviderFactory = () => ExchangeRateProvider;

export function createWorker(
  providerFactory: ExchangeRateProviderFactory = () => new EcbExchangeRateProvider(),
) {
  return {
    fetch(request: Request, env: Env, context: ExecutionContext) {
      return app.fetch(request, env, context);
    },

    async scheduled(controller: ScheduledController, env: Env) {
      const startedAt = Date.now();
      try {
        const repository = new D1OpenSubListsRepository(env.DB);
        const result = await new ExchangeRateRefreshService(
          repository,
          providerFactory(),
        ).refresh();
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
            durationMs: Date.now() - startedAt,
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
            durationMs: Date.now() - startedAt,
          }),
        );
        throw error;
      }
    },
  } satisfies ExportedHandler<Env>;
}

export default createWorker();

import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconChevronRight,
  IconCreditCard,
  IconDatabaseImport,
  IconPlus,
  IconReceipt,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type {
  Dashboard,
  PaymentMethodBreakdown,
  ReportingEstimate,
  UpcomingCharge,
} from "../../api/types";
import { PaymentMethodSymbol, SymbolGlyph } from "../../components/ResourceSymbol";
import {
  CategoryPill,
  InlineNotice,
  LoadingPage,
  PageMessage,
  QueryError,
  ServiceMark,
} from "../../components/ui";
import { currencySymbol, formatDate, formatMoney } from "../../utils/format";

function groupCharges(charges: UpcomingCharge[]) {
  return charges.reduce<Map<string, UpcomingCharge[]>>((groups, charge) => {
    const current = groups.get(charge.billingOn) ?? [];
    current.push(charge);
    groups.set(charge.billingOn, current);
    return groups;
  }, new Map());
}

function DashboardSummary({
  data,
  locale,
  days,
}: {
  data: Dashboard;
  locale: string;
  days: number;
}) {
  const { t } = useTranslation();
  return (
    <section className="dashboard-summary" aria-label={t("dashboard.nextCharge")}>
      <div className="dashboard-summary__next">
        <div className="summary-label">
          <IconCalendarEvent size={20} aria-hidden="true" />
          {t("dashboard.nextCharge")}
        </div>
        {data.nextCharge ? (
          <Link className="next-charge" to={`/subscriptions/${data.nextCharge.subscriptionId}`}>
            <ServiceMark
              name={data.nextCharge.name}
              symbol={data.nextCharge.symbol}
              color={data.nextCharge.category?.color}
            />
            <span className="next-charge__details">
              <strong>{data.nextCharge.name}</strong>
              <span className="next-charge__amount">
                {formatMoney(data.nextCharge.amount, data.nextCharge.currency, locale)}
                <small>{data.nextCharge.currency}</small>
              </span>
              <span>{formatDate(data.nextCharge.billingOn, locale)}</span>
            </span>
            <IconChevronRight className="next-charge__chevron" size={20} aria-hidden="true" />
          </Link>
        ) : (
          <p className="dashboard-summary__empty">{t("dashboard.noNextCharge")}</p>
        )}
      </div>
      <div className="dashboard-summary__totals">
        <div className="summary-label">{t("dashboard.dueIn", { days })}</div>
        <div className="currency-total-grid">
          {data.totalsByCurrency.length ? (
            data.totalsByCurrency.map((total) => (
              <div className="currency-total" key={total.currency}>
                <span
                  className={`currency-orb currency-orb--${total.currency.toLowerCase()}`}
                  aria-hidden="true"
                >
                  {currencySymbol(total.currency, locale)}
                </span>
                <span>
                  <small>{total.currency}</small>
                  <strong>{formatMoney(total.upcomingAmount, total.currency, locale)}</strong>
                </span>
              </div>
            ))
          ) : (
            <p className="dashboard-summary__empty">{t("dashboard.noWindowCharges")}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function UpcomingAgenda({
  data,
  locale,
  days,
  setDays,
}: {
  data: Dashboard;
  locale: string;
  days: 7 | 30;
  setDays: (days: 7 | 30) => void;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupCharges(data.upcoming), [data.upcoming]);
  return (
    <section className="surface dashboard-agenda">
      <div className="section-heading-row">
        <h2>{t("dashboard.upcoming")}</h2>
        <div className="segmented-control" aria-label={t("dashboard.upcoming")}>
          <button
            type="button"
            className={days === 7 ? "is-selected" : ""}
            onClick={() => setDays(7)}
          >
            {t("dashboard.days7")}
          </button>
          <button
            type="button"
            className={days === 30 ? "is-selected" : ""}
            onClick={() => setDays(30)}
          >
            {t("dashboard.days30")}
          </button>
        </div>
      </div>
      {groups.size ? (
        <div className="charge-groups">
          {[...groups.entries()].map(([date, charges]) => (
            <section className="charge-group" key={date}>
              <h3>{formatDate(date, locale)}</h3>
              {charges.map((charge, index) => (
                <Link
                  className="charge-row"
                  to={`/subscriptions/${charge.subscriptionId}`}
                  key={`${charge.subscriptionId}-${charge.billingOn}-${index}`}
                >
                  <ServiceMark
                    name={charge.name}
                    symbol={charge.symbol}
                    color={charge.category?.color}
                  />
                  <span className="charge-row__name">{charge.name}</span>
                  {charge.category ? (
                    <CategoryPill
                      name={charge.category.name}
                      color={charge.category.color}
                      symbol={charge.category.symbol}
                    />
                  ) : null}
                  <span className="charge-row__amount">
                    <strong>{formatMoney(charge.amount, charge.currency, locale)}</strong>
                    <small>{charge.currency}</small>
                  </span>
                </Link>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="agenda-empty">
          <IconReceipt size={26} aria-hidden="true" />
          <p>{t("dashboard.noWindowCharges")}</p>
        </div>
      )}
    </section>
  );
}

function ReportingAmount({ value, locale }: { value: ReportingEstimate | null; locale: string }) {
  const { t } = useTranslation();
  if (value === null) {
    return <span className="reporting-value--missing">{t("app.notAvailable")}</span>;
  }
  return (
    <>
      <strong>{formatMoney(value.amount, value.currency, locale)}</strong>
      <small>{value.currency}</small>
    </>
  );
}

function FxNotice({ data, locale }: { data: Dashboard; locale: string }) {
  const { t } = useTranslation();
  const fx = data.reporting.fx;
  if (fx.state === "not_needed") {
    return <p className="fx-status fx-status--not-needed">{t("dashboard.fxNotNeeded")}</p>;
  }
  if (fx.state === "unavailable") {
    return (
      <InlineNotice tone="danger">
        <IconAlertTriangle size={18} aria-hidden="true" />
        <span>
          {t("dashboard.fxUnavailable")}
          {fx.missingCurrencies.length
            ? ` ${t("dashboard.fxMissingCurrencies", { currencies: fx.missingCurrencies.join(", ") })}`
            : ""}
        </span>
      </InlineNotice>
    );
  }
  const source = t("dashboard.fxSourceDate", {
    provider: fx.provider?.toUpperCase() ?? "ECB",
    date: formatDate(fx.rateDate, locale) ?? fx.rateDate,
  });
  return (
    <InlineNotice tone={fx.state === "fresh" ? "success" : "info"}>
      {fx.state === "stale" ? <IconAlertTriangle size={18} aria-hidden="true" /> : null}
      <span>
        {source} · {t(fx.state === "fresh" ? "dashboard.fxFresh" : "dashboard.fxStale")}
      </span>
    </InlineNotice>
  );
}

function ReportingEstimates({ data, locale }: { data: Dashboard; locale: string }) {
  const { t } = useTranslation();
  const values: Array<{ label: string; value: ReportingEstimate | null }> = [
    { label: t("dashboard.estimatedMonthlyAverage"), value: data.reporting.monthlyAverage },
    { label: t("dashboard.estimatedAnnualized"), value: data.reporting.annualized },
    { label: t("dashboard.estimatedCurrentMonth"), value: data.reporting.currentMonthCharges },
    { label: t("dashboard.estimatedCurrentYear"), value: data.reporting.currentYearCharges },
  ];
  return (
    <section className="surface reporting-estimates">
      <div className="section-heading-row">
        <h2>{t("dashboard.reportingEstimates")}</h2>
        <span className="reporting-estimates__currency">{data.reporting.currency}</span>
      </div>
      <div className="reporting-estimates__grid">
        {values.map((item) => (
          <div className="reporting-estimate" key={item.label}>
            <span>{item.label}</span>
            <div className="reporting-estimate__amount">
              <ReportingAmount value={item.value} locale={locale} />
            </div>
          </div>
        ))}
      </div>
      <FxNotice data={data} locale={locale} />
      <p className="surface__footnote">{t("dashboard.estimateDisclaimer")}</p>
    </section>
  );
}

function EstimateRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function OriginalCurrencyEstimates({ data, locale }: { data: Dashboard; locale: string }) {
  const { t } = useTranslation();
  return (
    <section className="surface original-estimates">
      <h2>{t("dashboard.originalCurrencyEstimates")}</h2>
      <div className="original-estimates__grid">
        {data.totalsByCurrency.map((total) => (
          <article className="original-currency-card" key={total.currency}>
            <header>
              <span
                className={`currency-orb currency-orb--${total.currency.toLowerCase()}`}
                aria-hidden="true"
              >
                {currencySymbol(total.currency, locale)}
              </span>
              <strong>{total.currency}</strong>
            </header>
            <dl>
              <EstimateRow
                label={t("dashboard.monthlyEstimate")}
                value={formatMoney(total.monthlyEstimate, total.currency, locale)}
              />
              <EstimateRow
                label={t("dashboard.annualizedEstimate")}
                value={formatMoney(total.annualizedEstimate, total.currency, locale)}
              />
              <EstimateRow
                label={t("dashboard.currentMonthEstimate")}
                value={formatMoney(total.currentMonthCharges, total.currency, locale)}
              />
              <EstimateRow
                label={t("dashboard.currentYearEstimate")}
                value={formatMoney(total.currentYearCharges, total.currency, locale)}
              />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function CategoryBreakdown({ data, locale }: { data: Dashboard; locale: string }) {
  const { t } = useTranslation();
  const largest = Math.max(...data.categoryBreakdown.map((item) => item.subscriptionCount), 1);
  const total = data.categoryBreakdown.reduce((sum, item) => sum + item.subscriptionCount, 0);
  return (
    <section className="surface category-breakdown">
      <h2>{t("dashboard.categoryBreakdown")}</h2>
      <div className="category-breakdown__items">
        {data.categoryBreakdown.map((item) => (
          <div className="category-breakdown__item" key={item.categoryId ?? "uncategorized"}>
            <div>
              <span className="breakdown-label">
                {item.categoryName ? (
                  <CategoryPill
                    name={item.categoryName}
                    color={item.categoryColor ?? "#7c8798"}
                    symbol={item.categorySymbol}
                  />
                ) : (
                  t("dashboard.uncategorized")
                )}
              </span>
              <span className="breakdown-value">
                {item.reportingMonthlyAverage === null
                  ? item.subscriptionCount
                  : formatMoney(item.reportingMonthlyAverage, data.reporting.currency, locale)}
              </span>
            </div>
            <progress
              max={largest}
              value={item.subscriptionCount}
              style={{ "--progress-color": item.categoryColor ?? "#7c8798" } as React.CSSProperties}
              aria-label={`${item.categoryName ?? t("dashboard.uncategorized")}: ${item.subscriptionCount}`}
            />
          </div>
        ))}
      </div>
      <p className="surface__footnote">{t("dashboard.subscriptions", { count: total })}</p>
    </section>
  );
}

function PaymentBreakdownSymbol({ item }: { item: PaymentMethodBreakdown }) {
  if (item.paymentMethodSymbol) {
    return <SymbolGlyph symbol={item.paymentMethodSymbol} size={20} />;
  }
  return <PaymentMethodSymbol symbol={null} kind={item.paymentMethodKind ?? "other"} size={20} />;
}

function PaymentMethodBreakdownView({ data, locale }: { data: Dashboard; locale: string }) {
  const { t } = useTranslation();
  return (
    <section className="surface payment-breakdown">
      <h2>{t("dashboard.paymentMethodBreakdown")}</h2>
      <div className="payment-breakdown__items">
        {data.paymentMethodBreakdown.map((item) => (
          <div className="payment-breakdown__item" key={item.paymentMethodId ?? "none"}>
            <span className="breakdown-label">
              <PaymentBreakdownSymbol item={item} />
              {item.paymentMethodName ?? t("dashboard.noPaymentMethod")}
            </span>
            <span className="breakdown-value">
              {item.reportingMonthlyAverage === null
                ? item.subscriptionCount
                : formatMoney(item.reportingMonthlyAverage, data.reporting.currency, locale)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<7 | 30>(30);
  const query = useQuery({
    queryKey: ["dashboard", days],
    queryFn: () => api.dashboard(days),
  });

  if (query.isPending) return <LoadingPage variant="dashboard" />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data;
  const hasSubscriptions = Boolean(
    data.nextCharge || data.totalsByCurrency.length || data.categoryBreakdown.length,
  );

  return (
    <div className="page page--dashboard">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{t("app.name")}</p>
          <h1>{t("dashboard.title")}</h1>
        </div>
      </header>

      {!hasSubscriptions ? (
        <PageMessage
          icon={<IconCreditCard size={25} />}
          title={t("dashboard.emptyTitle")}
          body={t("dashboard.emptyBody")}
          actions={
            <>
              <Link className="button button--primary" to="/subscriptions/new?from=%2Fdashboard">
                <IconPlus size={19} />
                {t("app.addSubscription")}
              </Link>
              <Link className="button button--secondary" to="/settings/data">
                <IconDatabaseImport size={19} />
                {t("dashboard.importData")}
              </Link>
            </>
          }
        />
      ) : (
        <>
          <ReportingEstimates data={data} locale={i18n.language} />
          <DashboardSummary data={data} locale={i18n.language} days={days} />
          <UpcomingAgenda data={data} locale={i18n.language} days={days} setDays={setDays} />
          <OriginalCurrencyEstimates data={data} locale={i18n.language} />
          <div className="breakdown-grid">
            <CategoryBreakdown data={data} locale={i18n.language} />
            <PaymentMethodBreakdownView data={data} locale={i18n.language} />
          </div>
        </>
      )}
    </div>
  );
}

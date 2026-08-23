import { useQuery } from "@tanstack/react-query";
import {
  IconCalendarEvent,
  IconChevronRight,
  IconCreditCard,
  IconDatabaseImport,
  IconPlus,
  IconReceipt,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { Dashboard, UpcomingCharge } from "../../api/types";
import {
  CategoryPill,
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
            <ServiceMark name={data.nextCharge.name} color={data.nextCharge.category?.color} />
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
                  <ServiceMark name={charge.name} color={charge.category?.color} />
                  <span className="charge-row__name">{charge.name}</span>
                  {charge.category ? (
                    <CategoryPill name={charge.category.name} color={charge.category.color} />
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

function Estimates({ data, locale }: { data: Dashboard; locale: string }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  return (
    <section className="surface dashboard-estimates">
      <div className="section-heading-row section-heading-row--stack-mobile">
        <h2>
          {period === "monthly"
            ? t("dashboard.monthlyEstimate")
            : t("dashboard.annualizedEstimate")}
        </h2>
        <div
          className="segmented-control segmented-control--small"
          aria-label={t("dashboard.monthlyEstimate")}
        >
          <button
            type="button"
            className={period === "monthly" ? "is-selected" : ""}
            onClick={() => setPeriod("monthly")}
          >
            {t("dashboard.monthly")}
          </button>
          <button
            type="button"
            className={period === "annual" ? "is-selected" : ""}
            onClick={() => setPeriod("annual")}
          >
            {t("dashboard.annual")}
          </button>
        </div>
      </div>
      <div className="estimate-list">
        {data.totalsByCurrency.map((total) => (
          <div className="estimate-row" key={total.currency}>
            <span
              className={`currency-orb currency-orb--${total.currency.toLowerCase()}`}
              aria-hidden="true"
            >
              {currencySymbol(total.currency, locale)}
            </span>
            <span>{total.currency}</span>
            <strong>
              {formatMoney(
                period === "monthly" ? total.monthlyEstimate : total.annualizedEstimate,
                total.currency,
                locale,
              )}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function CategoryBreakdown({ data }: { data: Dashboard }) {
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
              <span>{item.categoryName ?? t("dashboard.uncategorized")}</span>
              <strong>{item.subscriptionCount}</strong>
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
  const hasSubscriptions = Boolean(data.nextCharge || data.categoryBreakdown.length);

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
          <DashboardSummary data={data} locale={i18n.language} days={days} />
          <div className="dashboard-grid">
            <UpcomingAgenda data={data} locale={i18n.language} days={days} setDays={setDays} />
            <aside className="dashboard-grid__side">
              <Estimates data={data} locale={i18n.language} />
              <CategoryBreakdown data={data} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

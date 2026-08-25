import { useQueries } from "@tanstack/react-query";
import { IconCategory, IconChevronRight, IconPlus, IconSettings } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { categoriesQueryKey } from "../../api/query-keys";
import { useSessionUserId } from "../../api/session";
import type { Category, CategoryBreakdown, Dashboard, Subscription } from "../../api/types";
import { CategorySymbol } from "../../components/ResourceSymbol";
import {
  InlineNotice,
  LoadingPage,
  PageMessage,
  QueryError,
  ServiceMark,
} from "../../components/ui";
import { formatDate, formatMoney } from "../../utils/format";

const activeSubscriptionParams = new URLSearchParams({
  status: "active",
  archived: "exclude",
});

type CategoryGroup = {
  id: string | null;
  name: string;
  color: string;
  symbol: Category["symbol"];
  subscriptions: Subscription[];
  breakdown: CategoryBreakdown | null;
};

function recurrenceLabel(subscription: Subscription, t: ReturnType<typeof useTranslation>["t"]) {
  return t(`subscriptions.interval.${subscription.recurrence.unit}`, {
    count: subscription.recurrence.count,
  });
}

function byNextBilling(left: Subscription, right: Subscription) {
  if (left.nextBillingOn === right.nextBillingOn) return left.name.localeCompare(right.name);
  if (left.nextBillingOn === null) return 1;
  if (right.nextBillingOn === null) return -1;
  return left.nextBillingOn.localeCompare(right.nextBillingOn);
}

function categoryPath(categoryId: string | null) {
  const params = new URLSearchParams({
    categoryId: categoryId ?? "none",
    status: "active",
  });
  return `/subscriptions?${params.toString()}`;
}

function reportingAmount(
  amount: string | null | undefined,
  dashboard: Dashboard,
  locale: string,
  unavailableLabel: string,
) {
  return amount === null || amount === undefined
    ? unavailableLabel
    : formatMoney(amount, dashboard.reporting.currency, locale);
}

function CategoryCard({
  group,
  dashboard,
  locale,
}: {
  group: CategoryGroup;
  dashboard: Dashboard;
  locale: string;
}) {
  const { t } = useTranslation();
  const nextRenewal = group.subscriptions.find((subscription) => subscription.nextBillingOn);
  const preview = group.subscriptions.slice(0, 3);
  const path = categoryPath(group.id);
  const cardStyle = { "--category-accent": group.color } as CSSProperties;

  return (
    <article className="category-overview-card" style={cardStyle}>
      <header className="category-overview-card__header">
        <span className="category-overview-card__symbol" aria-hidden="true">
          <CategorySymbol symbol={group.symbol} color={group.color} size={24} />
        </span>
        <div>
          <h2>
            <Link to={path}>{group.name}</Link>
          </h2>
          <p>{t("categories.subscriptionCount", { count: group.subscriptions.length })}</p>
        </div>
      </header>

      <dl className="category-overview-card__metrics">
        <div>
          <dt>{t("categories.estimatedMonthlyAverage")}</dt>
          <dd>
            {reportingAmount(
              group.breakdown?.reportingMonthlyAverage,
              dashboard,
              locale,
              t("categories.estimateUnavailable"),
            )}
          </dd>
        </div>
        <div>
          <dt>{t("categories.estimatedAnnualTotal")}</dt>
          <dd>
            {reportingAmount(
              group.breakdown?.reportingAnnualized,
              dashboard,
              locale,
              t("categories.estimateUnavailable"),
            )}
          </dd>
        </div>
      </dl>

      <section className="category-overview-card__next" aria-label={t("categories.nextRenewal")}>
        <span>{t("categories.nextRenewal")}</span>
        {nextRenewal ? (
          <div>
            <strong>{nextRenewal.name}</strong>
            <span>
              {formatMoney(nextRenewal.amount, nextRenewal.currency, locale)} ·{" "}
              {formatDate(nextRenewal.nextBillingOn, locale)}
            </span>
          </div>
        ) : (
          <p>{t("subscriptions.noUpcomingCharge")}</p>
        )}
      </section>

      <section className="category-overview-card__subscriptions">
        <h3>{t("categories.subscriptions")}</h3>
        <ul>
          {preview.map((subscription) => (
            <li key={subscription.id}>
              <Link to={`/subscriptions/${subscription.id}`}>
                <ServiceMark
                  name={subscription.name}
                  symbol={subscription.symbol}
                  color={group.color}
                />
                <span className="category-subscription-row__identity">
                  <strong>{subscription.name}</strong>
                  <small>
                    {recurrenceLabel(subscription, t)} ·{" "}
                    {formatDate(subscription.nextBillingOn, locale) ??
                      t("subscriptions.noUpcomingCharge")}
                  </small>
                </span>
                <span className="category-subscription-row__amount">
                  {formatMoney(subscription.amount, subscription.currency, locale)}
                </span>
                <IconChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {group.subscriptions.length > preview.length ? (
        <Link className="category-overview-card__all" to={path}>
          {t("categories.viewAll", { count: group.subscriptions.length })}
          <IconChevronRight size={18} aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}

function buildGroups(
  categories: Category[],
  subscriptions: Subscription[],
  breakdowns: CategoryBreakdown[],
  uncategorizedName: string,
): CategoryGroup[] {
  const activeSubscriptions = subscriptions
    .filter((subscription) => subscription.status === "active" && !subscription.archivedAt)
    .sort(byNextBilling);
  const breakdownByCategory = new Map(
    breakdowns.map((breakdown) => [breakdown.categoryId ?? "none", breakdown]),
  );
  const groups: CategoryGroup[] = categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      symbol: category.symbol,
      subscriptions: activeSubscriptions.filter(
        (subscription) => subscription.categoryId === category.id,
      ),
      breakdown: breakdownByCategory.get(category.id) ?? null,
    }))
    .filter((group) => group.subscriptions.length > 0);
  const uncategorized = activeSubscriptions.filter(
    (subscription) => subscription.categoryId === null,
  );
  if (uncategorized.length) {
    groups.push({
      id: null,
      name: uncategorizedName,
      color: "#7b8797",
      symbol: null,
      subscriptions: uncategorized,
      breakdown: breakdownByCategory.get("none") ?? null,
    });
  }
  return groups;
}

export function CategoriesPage() {
  const { t, i18n } = useTranslation();
  const userId = useSessionUserId();
  const [categoriesQuery, dashboardQuery, subscriptionsQuery] = useQueries({
    queries: [
      {
        queryKey: categoriesQueryKey(userId),
        queryFn: api.categories,
        enabled: userId !== "pending",
      },
      { queryKey: ["dashboard", 30], queryFn: () => api.dashboard(30) },
      {
        queryKey: ["subscriptions", activeSubscriptionParams.toString()],
        queryFn: () => api.subscriptions(activeSubscriptionParams),
      },
    ],
  });

  if (categoriesQuery.isPending || dashboardQuery.isPending || subscriptionsQuery.isPending) {
    return <LoadingPage variant="cards" />;
  }
  const error = categoriesQuery.error ?? dashboardQuery.error ?? subscriptionsQuery.error;
  if (error) {
    return (
      <QueryError
        error={error}
        onRetry={() => {
          void Promise.all([
            categoriesQuery.refetch(),
            dashboardQuery.refetch(),
            subscriptionsQuery.refetch(),
          ]);
        }}
      />
    );
  }

  if (!categoriesQuery.data || !dashboardQuery.data || !subscriptionsQuery.data) {
    return <LoadingPage variant="cards" />;
  }

  const groups = buildGroups(
    categoriesQuery.data,
    subscriptionsQuery.data,
    dashboardQuery.data.categoryBreakdown,
    t("categories.uncategorized"),
  );

  return (
    <div className="page page--categories">
      <header className="page-header categories-header">
        <div>
          <p className="page-eyebrow">{t("app.name")}</p>
          <h1>{t("categories.title")}</h1>
          <p>{t("categories.intro")}</p>
        </div>
        <Link className="button button--secondary" to="/settings/categories">
          <IconSettings size={18} aria-hidden="true" />
          {t("categories.manage")}
        </Link>
      </header>

      {dashboardQuery.data.reporting.fx.state === "unavailable" ? (
        <InlineNotice tone="warning">{t("categories.fxUnavailable")}</InlineNotice>
      ) : null}

      {groups.length ? (
        <section className="category-overview-grid" aria-label={t("categories.title")}>
          {groups.map((group) => (
            <CategoryCard
              key={group.id ?? "uncategorized"}
              group={group}
              dashboard={dashboardQuery.data}
              locale={i18n.language}
            />
          ))}
        </section>
      ) : (
        <PageMessage
          icon={<IconCategory size={25} />}
          title={t("categories.emptyTitle")}
          body={t("categories.emptyBody")}
          actions={
            <>
              <Link className="button button--primary" to="/subscriptions/new?from=%2Fcategories">
                <IconPlus size={19} aria-hidden="true" />
                {t("app.addSubscription")}
              </Link>
              <Link className="button button--secondary" to="/settings/categories">
                <IconSettings size={18} aria-hidden="true" />
                {t("categories.manage")}
              </Link>
            </>
          }
        />
      )}
    </div>
  );
}

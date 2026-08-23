import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  IconAdjustmentsHorizontal,
  IconArchive,
  IconArchiveOff,
  IconCalendar,
  IconChevronDown,
  IconCreditCard,
  IconExternalLink,
  IconLayoutGrid,
  IconList,
  IconListDetails,
  IconPlus,
  IconSearch,
  IconSortAscending,
} from "@tabler/icons-react";
import clsx from "clsx";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { Category, Dashboard, PaymentMethod, Subscription } from "../../api/types";
import {
  Button,
  CategoryPill,
  IconButton,
  InlineNotice,
  LoadingPage,
  PageMessage,
  QueryError,
  ServiceMark,
  StatusBadge,
} from "../../components/ui";
import {
  categoryFor,
  currencySymbol,
  formatDate,
  formatMoney,
  paymentMethodFor,
} from "../../utils/format";

type ViewMode = "grid" | "list";

const mobileCardQuery = "(max-width: 820px)";

function subscribeToMobileCardLayout(onChange: () => void) {
  const media = window.matchMedia(mobileCardQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function mobileCardLayoutSnapshot() {
  return window.matchMedia(mobileCardQuery).matches;
}

const filterKeys = [
  "q",
  "status",
  "categoryId",
  "paymentMethodId",
  "currency",
  "archived",
] as const;

function recurrenceLabel(subscription: Subscription, t: ReturnType<typeof useTranslation>["t"]) {
  const { count, unit } = subscription.recurrence;
  return t(`subscriptions.interval.${unit}`, { count });
}

function SubscriptionCard({
  subscription,
  categories,
  paymentMethods,
  locale,
  onToggleArchive,
  archiveBusy,
}: {
  subscription: Subscription;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  locale: string;
  onToggleArchive: (subscription: Subscription) => void;
  archiveBusy: boolean;
}) {
  const { t } = useTranslation();
  const category = categoryFor(subscription, categories);
  const paymentMethod = paymentMethodFor(subscription, paymentMethods);
  return (
    <article
      className={clsx(
        "subscription-card",
        subscription.status === "cancelled" && "subscription-card--cancelled",
        subscription.archivedAt && "subscription-card--archived",
      )}
      style={{ "--card-accent": category?.color ?? "#8b95a5" } as React.CSSProperties}
    >
      <div className="subscription-card__head">
        <ServiceMark name={subscription.name} color={category?.color} />
        <div className="subscription-card__identity">
          <div className="subscription-card__name-row">
            <h2>
              <Link to={`/subscriptions/${subscription.id}`}>{subscription.name}</Link>
            </h2>
            <span className="subscription-card__head-actions">
              <IconButton
                className="icon-button--subtle"
                label={subscription.archivedAt ? t("detail.unarchive") : t("detail.archive")}
                onClick={() => onToggleArchive(subscription)}
                disabled={archiveBusy}
              >
                {subscription.archivedAt ? <IconArchiveOff size={18} /> : <IconArchive size={18} />}
              </IconButton>
              <Link
                className="icon-button icon-button--subtle"
                to={`/subscriptions/${subscription.id}`}
                aria-label={t("subscriptions.openDetails", { name: subscription.name })}
              >
                <IconExternalLink size={18} />
              </Link>
            </span>
          </div>
          <p>{recurrenceLabel(subscription, t)}</p>
          <div className="subscription-card__badges">
            {category ? <CategoryPill name={category.name} color={category.color} /> : null}
            {subscription.status !== "active" || subscription.archivedAt ? (
              <StatusBadge
                status={subscription.status}
                archived={Boolean(subscription.archivedAt)}
              />
            ) : null}
          </div>
        </div>
      </div>
      <div className="subscription-card__amount">
        <strong>{formatMoney(subscription.amount, subscription.currency, locale)}</strong>
        <span>{subscription.currency}</span>
      </div>
      <div className="subscription-card__payment">
        <IconCreditCard size={17} aria-hidden="true" />
        <span>
          {paymentMethod
            ? [paymentMethod.name, paymentMethod.label].filter(Boolean).join(" ")
            : t("subscriptions.noPaymentMethod")}
        </span>
      </div>
      <div className="subscription-card__billing">
        <IconCalendar size={18} aria-hidden="true" />
        <span>{t("subscriptions.nextBillingLabel")}</span>
        <strong>
          {formatDate(subscription.nextBillingOn, locale) ?? t("subscriptions.noUpcomingCharge")}
        </strong>
      </div>
    </article>
  );
}

function SubscriptionTable({
  subscriptions,
  categories,
  paymentMethods,
  locale,
  onToggleArchive,
  archiveBusyId,
}: {
  subscriptions: Subscription[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  locale: string;
  onToggleArchive: (subscription: Subscription) => void;
  archiveBusyId: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="subscription-table-wrap">
      <table className="subscription-table">
        <thead>
          <tr>
            <th>{t("form.name")}</th>
            <th>{t("form.amount")}</th>
            <th>{t("subscriptions.nextBillingLabel")}</th>
            <th>{t("subscriptions.category")}</th>
            <th>{t("subscriptions.paymentMethod")}</th>
            <th>{t("subscriptions.status")}</th>
            <th>
              <span className="sr-only">{t("app.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((subscription) => {
            const category = categoryFor(subscription, categories);
            const payment = paymentMethodFor(subscription, paymentMethods);
            return (
              <tr key={subscription.id}>
                <td>
                  <Link
                    className="subscription-table__service"
                    to={`/subscriptions/${subscription.id}`}
                  >
                    <ServiceMark name={subscription.name} color={category?.color} />
                    <span>
                      <strong>{subscription.name}</strong>
                      <small>{recurrenceLabel(subscription, t)}</small>
                    </span>
                  </Link>
                </td>
                <td className="numeric-cell">
                  {formatMoney(subscription.amount, subscription.currency, locale)}
                </td>
                <td>
                  {formatDate(subscription.nextBillingOn, locale) ??
                    t("subscriptions.noUpcomingCharge")}
                </td>
                <td>
                  {category ? <CategoryPill name={category.name} color={category.color} /> : "—"}
                </td>
                <td>{payment ? [payment.name, payment.label].filter(Boolean).join(" ") : "—"}</td>
                <td>
                  <StatusBadge
                    status={subscription.status}
                    archived={Boolean(subscription.archivedAt)}
                  />
                </td>
                <td className="subscription-table__actions">
                  <IconButton
                    className="icon-button--subtle"
                    label={subscription.archivedAt ? t("detail.unarchive") : t("detail.archive")}
                    onClick={() => onToggleArchive(subscription)}
                    disabled={archiveBusyId === subscription.id}
                  >
                    {subscription.archivedAt ? (
                      <IconArchiveOff size={18} />
                    ) : (
                      <IconArchive size={18} />
                    )}
                  </IconButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ListSummary({
  data,
  dashboard,
  locale,
}: {
  data: Subscription[];
  dashboard: Dashboard | undefined;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="list-summary">
      <div className="list-summary__stat">
        <IconListDetails size={24} aria-hidden="true" />
        <strong>{t("subscriptions.count", { count: data.length })}</strong>
      </div>
      <div className="list-summary__stat list-summary__next">
        <IconCalendar size={24} aria-hidden="true" />
        <span>
          <small>{t("subscriptions.nextCharge")}</small>
          <strong>
            {formatDate(dashboard?.nextCharge?.billingOn ?? null, locale, {
              month: "short",
              day: "numeric",
            }) ?? "—"}
          </strong>
        </span>
      </div>
      <div className="list-summary__currencies">
        {dashboard?.totalsByCurrency.map((total) => (
          <div className="list-summary__currency" key={total.currency}>
            <span
              className={`currency-orb currency-orb--${total.currency.toLowerCase()}`}
              aria-hidden="true"
            >
              {currencySymbol(total.currency, locale)}
            </span>
            <span>
              <small>{total.currency}</small>
              <strong>{formatMoney(total.monthlyEstimate, total.currency, locale)}</strong>
              <small>{t("subscriptions.perMonth")}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SubscriptionsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const [searchDraft, setSearchDraft] = useState({ source: querySearch, value: querySearch });
  const searchValue = searchDraft.source === querySearch ? searchDraft.value : querySearch;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const queryClient = useQueryClient();
  const forceCardLayout = useSyncExternalStore(
    subscribeToMobileCardLayout,
    mobileCardLayoutSnapshot,
    () => false,
  );
  const [view, setView] = useState<ViewMode>(() =>
    localStorage.getItem("opensublists-subscription-view") === "list" ? "list" : "grid",
  );
  const queryString = searchParams.toString();

  const subscriptionQuery = useQuery({
    queryKey: ["subscriptions", queryString],
    queryFn: () => api.subscriptions(searchParams),
    placeholderData: keepPreviousData,
  });
  const [categoriesQuery, paymentMethodsQuery, dashboardQuery] = useQueries({
    queries: [
      { queryKey: ["categories"], queryFn: api.categories },
      { queryKey: ["payment-methods"], queryFn: api.paymentMethods },
      { queryKey: ["dashboard", 30], queryFn: () => api.dashboard(30) },
    ],
  });
  const archiveMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "archive" | "unarchive" }) =>
      api.subscriptionAction(id, action),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  useEffect(() => {
    localStorage.setItem("opensublists-subscription-view", view);
  }, [view]);

  useEffect(() => {
    if (searchValue === querySearch) return;
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchValue) next.set("q", searchValue);
      else next.delete("q");
      setSearchParams(next, { replace: true });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [querySearch, searchParams, searchValue, setSearchParams]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    const next = new URLSearchParams(searchParams);
    filterKeys.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  }

  function setSort(value: string) {
    const [sort, order] = value.split(":");
    const next = new URLSearchParams(searchParams);
    if (sort === "nextBillingOn" && order === "asc") {
      next.delete("sort");
      next.delete("order");
    } else {
      if (sort) next.set("sort", sort);
      if (order) next.set("order", order);
    }
    setSearchParams(next, { replace: true });
  }

  const currencies = useMemo(() => {
    const all = subscriptionQuery.data?.map((subscription) => subscription.currency) ?? [];
    return [...new Set(all)].sort();
  }, [subscriptionQuery.data]);
  const hasFilters = filterKeys.some((key) => searchParams.has(key));
  const categories = categoriesQuery.data ?? [];
  const paymentMethods = paymentMethodsQuery.data ?? [];

  if (subscriptionQuery.isPending || categoriesQuery.isPending || paymentMethodsQuery.isPending) {
    return <LoadingPage variant="cards" />;
  }
  if (subscriptionQuery.isError) {
    return (
      <QueryError
        error={subscriptionQuery.error}
        onRetry={() => void subscriptionQuery.refetch()}
      />
    );
  }
  const supportingError = categoriesQuery.error ?? paymentMethodsQuery.error;
  if (supportingError) {
    return <QueryError error={supportingError} />;
  }

  const subscriptions = subscriptionQuery.data;
  const sortValue = `${searchParams.get("sort") ?? "nextBillingOn"}:${searchParams.get("order") ?? "asc"}`;
  const archiveBusyId = archiveMutation.isPending ? archiveMutation.variables?.id : undefined;

  function toggleArchive(subscription: Subscription) {
    archiveMutation.mutate({
      id: subscription.id,
      action: subscription.archivedAt ? "unarchive" : "archive",
    });
  }

  return (
    <div className="page page--subscriptions">
      <header className="page-header subscriptions-header">
        <div>
          <p className="page-eyebrow">{t("app.name")}</p>
          <h1>{t("subscriptions.title")}</h1>
        </div>
        <div className="subscriptions-header__controls">
          <label className="search-control">
            <span className="sr-only">{t("subscriptions.search")}</span>
            <IconSearch size={20} aria-hidden="true" />
            <input
              type="search"
              placeholder={t("subscriptions.search")}
              value={searchValue}
              onChange={(event) =>
                setSearchDraft({ source: querySearch, value: event.target.value })
              }
            />
          </label>
          <label className="select-control select-control--sort">
            <IconSortAscending size={20} aria-hidden="true" />
            <span className="sr-only">{t("subscriptions.sort")}</span>
            <select value={sortValue} onChange={(event) => setSort(event.target.value)}>
              <option value="nextBillingOn:asc">{t("subscriptions.nextBilling")}</option>
              <option value="name:asc">{t("subscriptions.name")}</option>
              <option value="amount:desc">{t("subscriptions.amount")}</option>
              <option value="createdAt:desc">{t("subscriptions.recentlyAdded")}</option>
            </select>
            <IconChevronDown size={17} aria-hidden="true" />
          </label>
          <div className="view-toggle" role="group" aria-label={t("subscriptions.gridView")}>
            <button
              type="button"
              className={view === "grid" ? "is-selected" : ""}
              onClick={() => setView("grid")}
              aria-label={t("subscriptions.gridView")}
              aria-pressed={view === "grid"}
            >
              <IconLayoutGrid size={21} />
            </button>
            <button
              type="button"
              className={view === "list" ? "is-selected" : ""}
              onClick={() => setView("list")}
              aria-label={t("subscriptions.listView")}
              aria-pressed={view === "list"}
            >
              <IconList size={21} />
            </button>
          </div>
        </div>
      </header>

      <ListSummary data={subscriptions} dashboard={dashboardQuery.data} locale={i18n.language} />

      {archiveMutation.isError ? (
        <InlineNotice tone="danger">{archiveMutation.error.message}</InlineNotice>
      ) : null}

      <Button
        className="mobile-filter-button"
        variant="secondary"
        onClick={() => setFiltersOpen((open) => !open)}
        aria-expanded={filtersOpen}
      >
        <IconAdjustmentsHorizontal size={19} />
        {t("subscriptions.filters")}
        {hasFilters ? (
          <span className="filter-count">
            {filterKeys.filter((key) => searchParams.has(key)).length}
          </span>
        ) : null}
      </Button>

      <section
        className={clsx("filter-panel", filtersOpen && "is-open")}
        aria-label={t("subscriptions.filters")}
      >
        <label className="filter-field">
          <span>{t("subscriptions.status")}</span>
          <select
            value={searchParams.get("status") ?? ""}
            onChange={(event) => setParam("status", event.target.value)}
          >
            <option value="">{t("subscriptions.all")}</option>
            <option value="active">{t("subscriptions.active")}</option>
            <option value="cancelled">{t("subscriptions.cancelled")}</option>
          </select>
        </label>
        <label className="filter-field">
          <span>{t("subscriptions.category")}</span>
          <select
            value={searchParams.get("categoryId") ?? ""}
            onChange={(event) => setParam("categoryId", event.target.value)}
          >
            <option value="">{t("subscriptions.all")}</option>
            <option value="none">{t("subscriptions.noCategory")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>{t("subscriptions.paymentMethod")}</span>
          <select
            value={searchParams.get("paymentMethodId") ?? ""}
            onChange={(event) => setParam("paymentMethodId", event.target.value)}
          >
            <option value="">{t("subscriptions.all")}</option>
            <option value="none">{t("subscriptions.noPaymentMethod")}</option>
            {paymentMethods.map((paymentMethod) => (
              <option key={paymentMethod.id} value={paymentMethod.id}>
                {paymentMethod.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>{t("subscriptions.currency")}</span>
          <select
            value={searchParams.get("currency") ?? ""}
            onChange={(event) => setParam("currency", event.target.value)}
          >
            <option value="">{t("subscriptions.all")}</option>
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field filter-field--archived">
          <span>{t("subscriptions.archived")}</span>
          <select
            value={searchParams.get("archived") ?? "exclude"}
            onChange={(event) =>
              setParam("archived", event.target.value === "exclude" ? "" : event.target.value)
            }
          >
            <option value="exclude">{t("subscriptions.excludeArchived")}</option>
            <option value="only">{t("subscriptions.onlyArchived")}</option>
            <option value="include">{t("subscriptions.includeArchived")}</option>
          </select>
        </label>
        {hasFilters ? (
          <Button className="filter-panel__clear" variant="ghost" onClick={clearFilters}>
            {t("subscriptions.clearFilters")}
          </Button>
        ) : null}
      </section>

      {subscriptions.length ? (
        <>
          {view === "grid" || forceCardLayout ? (
            <section
              className="subscription-grid"
              aria-label={t("subscriptions.title")}
              aria-busy={subscriptionQuery.isFetching}
            >
              {subscriptions.map((subscription) => (
                <SubscriptionCard
                  key={subscription.id}
                  subscription={subscription}
                  categories={categories}
                  paymentMethods={paymentMethods}
                  locale={i18n.language}
                  onToggleArchive={toggleArchive}
                  archiveBusy={archiveBusyId === subscription.id}
                />
              ))}
            </section>
          ) : (
            <SubscriptionTable
              subscriptions={subscriptions}
              categories={categories}
              paymentMethods={paymentMethods}
              locale={i18n.language}
              onToggleArchive={toggleArchive}
              archiveBusyId={archiveBusyId}
            />
          )}
          <footer className="list-footer">
            {t("subscriptions.showing", { count: subscriptions.length })}
          </footer>
        </>
      ) : (
        <PageMessage
          icon={<IconCreditCard size={25} />}
          title={hasFilters ? t("subscriptions.filteredEmptyTitle") : t("subscriptions.emptyTitle")}
          body={hasFilters ? t("subscriptions.filteredEmptyBody") : t("subscriptions.emptyBody")}
          actions={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                {t("subscriptions.clearFilters")}
              </Button>
            ) : (
              <Link
                className="button button--primary"
                to="/subscriptions/new?from=%2Fsubscriptions"
              >
                <IconPlus size={19} />
                {t("app.addSubscription")}
              </Link>
            )
          }
        />
      )}
    </div>
  );
}

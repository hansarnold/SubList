import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArchive,
  IconArrowLeft,
  IconBell,
  IconCalendarEvent,
  IconEdit,
  IconExternalLink,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import { categoriesQueryKey, paymentMethodsQueryKey, sessionQueryKey } from "../../api/query-keys";
import { PaymentMethodSymbol } from "../../components/ResourceSymbol";
import {
  Button,
  CategoryPill,
  Dialog,
  InlineNotice,
  LoadingPage,
  PageMessage,
  QueryError,
  ServiceMark,
  StatusBadge,
} from "../../components/ui";
import {
  categoryFor,
  formatDate,
  formatMoney,
  formatTimestamp,
  paymentMethodFor,
  previewOccurrences,
} from "../../utils/format";
import { addCalendarDays } from "../../../domain/calendar-date";

type ConfirmAction = "cancel" | "reactivate" | "delete" | null;

export function SubscriptionDetailPage() {
  const { subscriptionId = "" } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({ queryKey: sessionQueryKey, queryFn: api.session });
  const userId = sessionQuery.data?.user.id ?? "pending";
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const subscriptionQuery = useQuery({
    queryKey: ["subscription", subscriptionId],
    queryFn: () => api.subscription(subscriptionId),
  });
  const [categoriesQuery, paymentMethodsQuery] = useQueries({
    queries: [
      {
        queryKey: categoriesQueryKey(userId),
        queryFn: api.categories,
        enabled: userId !== "pending",
      },
      {
        queryKey: paymentMethodsQueryKey(userId),
        queryFn: api.paymentMethods,
        enabled: userId !== "pending",
      },
    ],
  });

  const actionMutation = useMutation({
    mutationFn: (action: "cancel" | "reactivate" | "archive" | "unarchive") =>
      api.subscriptionAction(subscriptionId, action),
    onSuccess: async (_updated, action) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscription", subscriptionId] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      setConfirmAction(null);
      if (action === "archive") setNotice(t("detail.archived"));
      if (action === "unarchive") setNotice(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteSubscription(subscriptionId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      void navigate("/subscriptions", { replace: true });
    },
  });

  const occurrences = useMemo(
    () =>
      subscriptionQuery.data?.nextBillingOn
        ? previewOccurrences(
            subscriptionQuery.data.recurrence,
            3,
            subscriptionQuery.data.nextBillingOn,
          )
        : [],
    [subscriptionQuery.data],
  );

  if (
    sessionQuery.isPending ||
    subscriptionQuery.isPending ||
    categoriesQuery.isPending ||
    paymentMethodsQuery.isPending
  ) {
    return <LoadingPage variant="form" />;
  }
  if (subscriptionQuery.isError) {
    if (subscriptionQuery.error instanceof ApiError && subscriptionQuery.error.status === 404) {
      return (
        <PageMessage
          title={t("detail.notFoundTitle")}
          body={t("detail.notFoundBody")}
          actions={
            <Link className="button button--secondary" to="/subscriptions">
              {t("app.back")}
            </Link>
          }
        />
      );
    }
    return (
      <QueryError
        error={subscriptionQuery.error}
        onRetry={() => void subscriptionQuery.refetch()}
      />
    );
  }
  const supportingError = sessionQuery.error ?? categoriesQuery.error ?? paymentMethodsQuery.error;
  if (supportingError) {
    return <QueryError error={supportingError} />;
  }
  const session = sessionQuery.data;
  if (!session) {
    return <LoadingPage variant="form" />;
  }

  const subscription = subscriptionQuery.data;
  const account = session.user;
  const category = categoryFor(subscription, categoriesQuery.data ?? []);
  const paymentMethod = paymentMethodFor(subscription, paymentMethodsQuery.data ?? []);
  const mutationError = actionMutation.error ?? deleteMutation.error;
  const recurrence = t(`subscriptions.interval.${subscription.recurrence.unit}`, {
    count: subscription.recurrence.count,
  });
  const effectiveReminderDaysBefore =
    subscription.emailReminderDaysBefore ?? account.defaultEmailReminderDaysBefore;
  const delivery = subscription.emailReminderDelivery;
  const plannedReminderOn =
    subscription.emailReminderEnabled &&
    delivery.occurrenceOn !== null &&
    ["scheduled", "paused", "retrying"].includes(delivery.state)
      ? addCalendarDays(delivery.occurrenceOn, -effectiveReminderDaysBefore)
      : null;

  const dialog =
    confirmAction === "cancel"
      ? {
          title: t("detail.cancelTitle", { name: subscription.name }),
          body: t("detail.cancelBody"),
          label: t("detail.cancel"),
          danger: false,
        }
      : confirmAction === "reactivate"
        ? {
            title: t("detail.reactivateTitle", { name: subscription.name }),
            body: t("detail.reactivateBody"),
            label: t("detail.reactivate"),
            danger: false,
          }
        : {
            title: t("detail.deleteTitle", { name: subscription.name }),
            body: t("detail.deleteBody"),
            label: t("detail.deletePermanently"),
            danger: true,
          };

  function confirm() {
    if (confirmAction === "delete") deleteMutation.mutate();
    else if (confirmAction) actionMutation.mutate(confirmAction);
  }

  return (
    <div className="page page--detail">
      <header className="page-header detail-header">
        <div>
          <Link className="back-link" to="/subscriptions">
            <IconArrowLeft size={19} />
            {t("nav.subscriptions")}
          </Link>
          <div className="detail-header__identity">
            <ServiceMark
              name={subscription.name}
              symbol={subscription.symbol}
              color={category?.color}
            />
            <div>
              <h1>{subscription.name}</h1>
              <div className="detail-header__badges">
                <StatusBadge
                  status={subscription.status}
                  archived={Boolean(subscription.archivedAt)}
                />
                {category ? (
                  <CategoryPill
                    name={category.name}
                    color={category.color}
                    symbol={category.symbol}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <Link className="button button--primary" to={`/subscriptions/${subscription.id}/edit`}>
          <IconEdit size={19} />
          {t("app.edit")}
        </Link>
      </header>

      {mutationError ? (
        <InlineNotice tone="danger">
          {mutationError instanceof Error ? mutationError.message : t("app.unknownError")}
        </InlineNotice>
      ) : null}

      <div className="detail-grid">
        <section className="surface detail-hero">
          <div className="detail-hero__amount">
            <strong>
              {formatMoney(subscription.amount, subscription.currency, i18n.language)}
            </strong>
            <span>{subscription.currency}</span>
          </div>
          <dl className="detail-key-values">
            <div>
              <dt>{t("detail.recurrence")}</dt>
              <dd>{recurrence}</dd>
            </div>
            <div>
              <dt>{t("detail.nextBilling")}</dt>
              <dd>
                {formatDate(subscription.nextBillingOn, i18n.language) ??
                  t("subscriptions.noUpcomingCharge")}
              </dd>
            </div>
          </dl>
        </section>

        <section className="surface detail-occurrences">
          <div className="summary-label">
            <IconCalendarEvent size={20} />
            {t("detail.nextCharges")}
          </div>
          {subscription.status === "active" && !subscription.archivedAt ? (
            <ol>
              {occurrences.map((date) => (
                <li key={date}>{formatDate(date, i18n.language)}</li>
              ))}
            </ol>
          ) : (
            <p>{t("subscriptions.noUpcomingCharge")}</p>
          )}
        </section>
      </div>

      <section className="surface detail-section">
        <h2>{t("detail.subscriptionDetails")}</h2>
        <dl className="detail-list">
          <div>
            <dt>{t("detail.category")}</dt>
            <dd>
              {category ? (
                <CategoryPill
                  name={category.name}
                  color={category.color}
                  symbol={category.symbol}
                />
              ) : (
                t("subscriptions.noCategory")
              )}
            </dd>
          </div>
          <div>
            <dt>{t("detail.paymentMethod")}</dt>
            <dd className="detail-list__icon-value">
              <PaymentMethodSymbol
                symbol={paymentMethod?.symbol ?? null}
                kind={paymentMethod?.kind ?? "other"}
                size={18}
              />
              {paymentMethod
                ? [paymentMethod.name, paymentMethod.label].filter(Boolean).join(" ")
                : t("subscriptions.noPaymentMethod")}
            </dd>
          </div>
          <div>
            <dt>{t("detail.website")}</dt>
            <dd>
              {subscription.websiteUrl ? (
                <a href={subscription.websiteUrl} target="_blank" rel="noreferrer">
                  {subscription.websiteUrl}
                  <IconExternalLink size={16} />
                </a>
              ) : (
                t("app.notAvailable")
              )}
            </dd>
          </div>
          <div>
            <dt>{t("detail.notes")}</dt>
            <dd className="detail-notes">{subscription.notes ?? t("app.notAvailable")}</dd>
          </div>
        </dl>
      </section>

      <section className="surface detail-section reminder-detail">
        <div className="reminder-detail__heading">
          <span>
            <IconBell size={20} aria-hidden="true" />
            <h2>{t("detail.renewalEmail")}</h2>
          </span>
          <span
            className={`reminder-status reminder-status--${
              subscription.emailReminderEnabled ? delivery.state : "none"
            }`}
          >
            {subscription.emailReminderEnabled
              ? t(`detail.reminderStates.${delivery.state}`)
              : t("detail.reminderOff")}
          </span>
        </div>
        {!subscription.emailReminderEnabled ? (
          <div className="reminder-detail__empty">
            <p>{t("detail.reminderOffHelp")}</p>
            <Link
              className="button button--secondary"
              to={`/subscriptions/${subscription.id}/edit`}
            >
              {t("detail.configureReminder")}
            </Link>
          </div>
        ) : (
          <>
            {!session.capabilities.emailReminders ? (
              <InlineNotice tone="warning">{t("detail.reminderUnavailable")}</InlineNotice>
            ) : account.emailReminderSystemSuspended ? (
              <InlineNotice tone="danger">{t("detail.reminderSystemSuspended")}</InlineNotice>
            ) : account.emailRemindersPaused ? (
              <InlineNotice tone="warning">{t("detail.remindersPaused")}</InlineNotice>
            ) : null}
            <dl className="detail-list reminder-detail__list">
              <div>
                <dt>{t("detail.reminderRecipient")}</dt>
                <dd>{account.email}</dd>
              </div>
              <div>
                <dt>{t("detail.reminderLead")}</dt>
                <dd>
                  {t("detail.reminderDaysBefore", { count: effectiveReminderDaysBefore })}
                  {subscription.emailReminderDaysBefore === null
                    ? ` · ${t("detail.inheritsAccountDefault")}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>{t("detail.plannedReminder")}</dt>
                <dd>
                  {plannedReminderOn
                    ? t("detail.plannedReminderValue", {
                        date: formatDate(plannedReminderOn, i18n.language),
                        time: account.emailReminderLocalTime,
                        timeZone: account.timezone,
                      })
                    : t("app.notAvailable")}
                </dd>
              </div>
              <div>
                <dt>{t("detail.reminderOccurrence")}</dt>
                <dd>{formatDate(delivery.occurrenceOn, i18n.language) ?? t("app.notAvailable")}</dd>
              </div>
              <div>
                <dt>{t("detail.lastReminderAttempt")}</dt>
                <dd>
                  {delivery.lastAttemptAt
                    ? formatTimestamp(delivery.lastAttemptAt, i18n.language)
                    : t("app.notAvailable")}
                </dd>
              </div>
            </dl>
            <p className="reminder-detail__disclaimer">{t("detail.reminderDisclaimer")}</p>
          </>
        )}
      </section>

      <section className="surface detail-section detail-actions">
        <div className="detail-actions__group">
          {subscription.status === "active" ? (
            <Button variant="secondary" onClick={() => setConfirmAction("cancel")}>
              <IconX size={19} />
              {t("detail.cancel")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmAction("reactivate")}>
              <IconPlayerPlay size={19} />
              {t("detail.reactivate")}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => actionMutation.mutate(subscription.archivedAt ? "unarchive" : "archive")}
            disabled={actionMutation.isPending}
          >
            <IconArchive size={19} />
            {subscription.archivedAt ? t("detail.unarchive") : t("detail.archive")}
          </Button>
        </div>
      </section>

      <section className="surface danger-zone">
        <div>
          <h2>{t("detail.dangerZone")}</h2>
          <p>{t("detail.deleteBody")}</p>
        </div>
        <Button variant="danger" onClick={() => setConfirmAction("delete")}>
          <IconTrash size={19} />
          {t("detail.deletePermanently")}
        </Button>
      </section>

      <section className="record-info">
        <h2>{t("detail.record")}</h2>
        <dl>
          <div>
            <dt>{t("detail.created")}</dt>
            <dd>{formatTimestamp(subscription.createdAt, i18n.language)}</dd>
          </div>
          <div>
            <dt>{t("detail.updated")}</dt>
            <dd>{formatTimestamp(subscription.updatedAt, i18n.language)}</dd>
          </div>
        </dl>
      </section>

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <Button variant="ghost" onClick={() => actionMutation.mutate("unarchive")}>
            {t("detail.unarchive")}
          </Button>
          <button type="button" aria-label={t("app.close")} onClick={() => setNotice(null)}>
            <IconX size={18} />
          </button>
        </div>
      ) : null}

      <Dialog
        open={confirmAction !== null}
        title={dialog.title}
        body={dialog.body}
        confirmLabel={dialog.label}
        danger={dialog.danger}
        busy={actionMutation.isPending || deleteMutation.isPending}
        onConfirm={confirm}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}

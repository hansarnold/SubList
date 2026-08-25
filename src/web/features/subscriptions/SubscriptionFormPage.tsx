import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft, IconBell, IconCalendarEvent, IconChevronDown } from "@tabler/icons-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import { categoriesQueryKey, paymentMethodsQueryKey, sessionQueryKey } from "../../api/query-keys";
import { type ResourceSymbol } from "../../../domain/symbol";
import type {
  Category,
  PaymentMethod,
  RecurrenceUnit,
  Subscription,
  SubscriptionInput,
  User,
} from "../../api/types";
import { Button, Field, InlineNotice, LoadingPage, QueryError } from "../../components/ui";
import { ResourceAssociationField } from "../../components/ResourceAssociationField";
import { SymbolPicker } from "../../components/SymbolPicker";
import { useSymbolPickerCopy } from "../../components/useSymbolPickerCopy";
import { formatDate, previewOccurrences } from "../../utils/format";
import { buildReminderDatePreview } from "./reminder-preview";

type FormState = {
  name: string;
  symbol: ResourceSymbol;
  amount: string;
  currency: string;
  recurrenceCount: string;
  recurrenceUnit: RecurrenceUnit;
  anchorOn: string;
  endOfMonth: boolean;
  categoryId: string;
  paymentMethodId: string;
  websiteUrl: string;
  notes: string;
  emailReminderEnabled: boolean;
  emailReminderDaysBefore: string;
};

type FormErrors = Partial<Record<keyof FormState | "form", string>>;

const formFieldIds: Partial<Record<keyof FormState, string>> = {
  name: "subscription-name",
  amount: "subscription-amount",
  currency: "subscription-currency",
  recurrenceCount: "subscription-recurrence-count",
  recurrenceUnit: "subscription-recurrence-unit",
  anchorOn: "subscription-anchor-on",
  categoryId: "subscription-category",
  paymentMethodId: "subscription-payment-method",
  emailReminderEnabled: "subscription-email-reminder-enabled",
  websiteUrl: "subscription-website-url",
  notes: "subscription-notes",
  emailReminderDaysBefore: "subscription-email-reminder-days-before",
};

const formFocusOrder: Array<keyof FormState> = [
  "name",
  "amount",
  "currency",
  "recurrenceCount",
  "recurrenceUnit",
  "anchorOn",
  "categoryId",
  "paymentMethodId",
  "emailReminderDaysBefore",
  "websiteUrl",
  "notes",
];

function focusFirstInvalidField(errors: FormErrors) {
  const firstKey = formFocusOrder.find((key) => Boolean(errors[key]));
  const fieldId = firstKey ? formFieldIds[firstKey] : undefined;
  if (!fieldId) return;
  window.requestAnimationFrame(() => {
    const field = document.getElementById(fieldId);
    const details = field?.closest("details");
    if (details) details.open = true;
    field?.focus();
  });
}

function todayDateOnly() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function initialState(): FormState {
  return {
    name: "",
    symbol: null,
    amount: "",
    currency: "USD",
    recurrenceCount: "1",
    recurrenceUnit: "month",
    anchorOn: todayDateOnly(),
    endOfMonth: false,
    categoryId: "",
    paymentMethodId: "",
    websiteUrl: "",
    notes: "",
    emailReminderEnabled: false,
    emailReminderDaysBefore: "",
  };
}

function stateFromSubscription(subscription: Subscription): FormState {
  return {
    name: subscription.name,
    symbol: subscription.symbol,
    amount: subscription.amount,
    currency: subscription.currency,
    recurrenceCount: String(subscription.recurrence.count),
    recurrenceUnit: subscription.recurrence.unit,
    anchorOn: subscription.recurrence.anchorOn,
    endOfMonth: subscription.recurrence.anchorMode === "end_of_month",
    categoryId: subscription.categoryId ?? "",
    paymentMethodId: subscription.paymentMethodId ?? "",
    websiteUrl: subscription.websiteUrl ?? "",
    notes: subscription.notes ?? "",
    emailReminderEnabled: subscription.emailReminderEnabled,
    emailReminderDaysBefore:
      subscription.emailReminderDaysBefore === null
        ? ""
        : String(subscription.emailReminderDaysBefore),
  };
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month ?? 1) - 1 &&
    date.getUTCDate() === day
  );
}

function toInput(state: FormState): SubscriptionInput {
  return {
    name: state.name.trim(),
    symbol: state.symbol,
    amount: state.amount,
    currency: state.currency.toUpperCase(),
    recurrence: {
      unit: state.recurrenceUnit,
      count: Number(state.recurrenceCount),
      anchorOn: state.anchorOn,
      anchorMode:
        state.recurrenceUnit === "month" && state.endOfMonth ? "end_of_month" : "calendar_day",
    },
    categoryId: state.categoryId || null,
    paymentMethodId: state.paymentMethodId || null,
    websiteUrl: state.websiteUrl.trim() || null,
    notes: state.notes.trim() || null,
    emailReminderEnabled: state.emailReminderEnabled,
    emailReminderDaysBefore:
      state.emailReminderDaysBefore === "" ? null : Number(state.emailReminderDaysBefore),
  };
}

function safeReturnDestination(value: string | null) {
  if (!value) return "/subscriptions";
  const approvedPaths = [
    /^\/dashboard$/,
    /^\/subscriptions$/,
    /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    /^\/settings\/(?:profile|categories|payment-methods|data)$/,
  ];
  return approvedPaths.some((pattern) => pattern.test(value)) ? value : "/subscriptions";
}

type SubscriptionFormEditorProps = {
  subscriptionId: string | undefined;
  subscription: Subscription | undefined;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  categoriesLoading: boolean;
  paymentMethodsLoading: boolean;
  categoriesError: unknown;
  paymentMethodsError: unknown;
  retryCategories: () => void;
  retryPaymentMethods: () => void;
  userId: string;
  account: User;
  emailRemindersAvailable: boolean;
  backTo: string;
};

function SubscriptionFormEditor({
  subscriptionId,
  subscription,
  categories,
  paymentMethods,
  categoriesLoading,
  paymentMethodsLoading,
  categoriesError,
  paymentMethodsError,
  retryCategories,
  retryPaymentMethods,
  userId,
  account,
  emailRemindersAvailable,
  backTo,
}: SubscriptionFormEditorProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = Boolean(subscriptionId);
  const [form, setForm] = useState<FormState>(() =>
    subscription
      ? stateFromSubscription(subscription)
      : { ...initialState(), currency: account.reportingCurrency },
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [resourceCreatePending, setResourceCreatePending] = useState({
    category: false,
    paymentMethod: false,
  });
  const symbolPicker = useSymbolPickerCopy();
  const setCategoryPending = useCallback(
    (pending: boolean) =>
      setResourceCreatePending((current) =>
        current.category === pending ? current : { ...current, category: pending },
      ),
    [],
  );
  const setPaymentMethodPending = useCallback(
    (pending: boolean) =>
      setResourceCreatePending((current) =>
        current.paymentMethod === pending ? current : { ...current, paymentMethod: pending },
      ),
    [],
  );
  const inlineResourceBusy = resourceCreatePending.category || resourceCreatePending.paymentMethod;
  const categoryAssociationId =
    categoriesLoading || categoriesError
      ? form.categoryId
      : categories.some((category) => category.id === form.categoryId)
        ? form.categoryId
        : "";
  const paymentMethodAssociationId =
    paymentMethodsLoading || paymentMethodsError
      ? form.paymentMethodId
      : paymentMethods.some((paymentMethod) => paymentMethod.id === form.paymentMethodId)
        ? form.paymentMethodId
        : "";

  const mutation = useMutation({
    mutationFn: (input: SubscriptionInput) =>
      subscriptionId
        ? api.updateSubscription(subscriptionId, input)
        : api.createSubscription(input),
    onSuccess: async (subscription) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription", subscription.id] }),
      ]);
      void navigate(`/subscriptions/${subscription.id}`, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details.length) {
        const mapped: FormErrors = { form: error.message };
        for (const detail of error.details) {
          const path = detail.path.replace("recurrence.", "");
          const key =
            path === "count"
              ? "recurrenceCount"
              : path === "unit"
                ? "recurrenceUnit"
                : path === "anchorOn"
                  ? "anchorOn"
                  : (path as keyof FormState);
          mapped[key] = detail.message;
        }
        setErrors(mapped);
        focusFirstInvalidField(mapped);
      } else {
        setErrors({ form: error instanceof Error ? error.message : t("app.unknownError") });
      }
    },
  });

  const occurrences = useMemo(
    () =>
      previewOccurrences({
        unit: form.recurrenceUnit,
        count: Number(form.recurrenceCount),
        anchorOn: form.anchorOn,
        anchorMode:
          form.recurrenceUnit === "month" && form.endOfMonth ? "end_of_month" : "calendar_day",
      }),
    [form.anchorOn, form.endOfMonth, form.recurrenceCount, form.recurrenceUnit],
  );
  const reminderLeadIsCustom = form.emailReminderDaysBefore !== "";
  const effectiveReminderDaysBefore = reminderLeadIsCustom
    ? Number(form.emailReminderDaysBefore)
    : account.defaultEmailReminderDaysBefore;
  const persistedReminderEnabled = subscription?.emailReminderEnabled ?? false;
  const showReminderSection = emailRemindersAvailable || persistedReminderEnabled;
  const reminderPreview = useMemo(() => {
    if (
      !form.emailReminderEnabled ||
      !Number.isInteger(effectiveReminderDaysBefore) ||
      effectiveReminderDaysBefore < 0 ||
      effectiveReminderDaysBefore > 365 ||
      !Number.isInteger(Number(form.recurrenceCount)) ||
      Number(form.recurrenceCount) < 1 ||
      Number(form.recurrenceCount) > 1200 ||
      !isRealDate(form.anchorOn)
    ) {
      return null;
    }

    try {
      return buildReminderDatePreview(
        {
          unit: form.recurrenceUnit,
          count: Number(form.recurrenceCount),
          anchorOn: form.anchorOn,
          anchorMode:
            form.recurrenceUnit === "month" && form.endOfMonth ? "end_of_month" : "calendar_day",
        },
        effectiveReminderDaysBefore,
        account.timezone,
      );
    } catch {
      return null;
    }
  }, [
    account.timezone,
    effectiveReminderDaysBefore,
    form.anchorOn,
    form.emailReminderEnabled,
    form.endOfMonth,
    form.recurrenceCount,
    form.recurrenceUnit,
  ]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        delete next.form;
        return next;
      });
    }
  }

  function validate() {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = t("form.required");
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(form.amount)) next.amount = t("form.invalidAmount");
    if (!/^[A-Za-z]{3}$/.test(form.currency)) next.currency = t("form.required");
    if (
      !/^\d+$/.test(form.recurrenceCount) ||
      Number(form.recurrenceCount) < 1 ||
      Number(form.recurrenceCount) > 1200
    ) {
      next.recurrenceCount = t("form.required");
    }
    if (!isRealDate(form.anchorOn)) next.anchorOn = t("form.invalidDate");
    if (
      form.emailReminderEnabled &&
      reminderLeadIsCustom &&
      (!/^\d+$/.test(form.emailReminderDaysBefore) ||
        Number(form.emailReminderDaysBefore) < 0 ||
        Number(form.emailReminderDaysBefore) > 365)
    ) {
      next.emailReminderDaysBefore = t("form.invalidReminderDays");
    }
    if (form.websiteUrl.trim()) {
      try {
        const url = new URL(form.websiteUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          next.websiteUrl = t("form.invalidUrl");
      } catch {
        next.websiteUrl = t("form.invalidUrl");
      }
    }
    return next;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (inlineResourceBusy) return;
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      focusFirstInvalidField(validationErrors);
      return;
    }
    mutation.mutate(
      toInput({
        ...form,
        categoryId: categoryAssociationId,
        paymentMethodId: paymentMethodAssociationId,
      }),
    );
  }

  return (
    <div className="page page--form">
      <header className="page-header page-header--form">
        <div>
          <Link className="back-link" to={backTo}>
            <IconArrowLeft size={19} />
            {t("app.back")}
          </Link>
          <h1>{isEditing ? t("form.editTitle") : t("form.newTitle")}</h1>
        </div>
      </header>

      <form className="subscription-form" onSubmit={submit} noValidate>
        <div className="subscription-form__main">
          <section className="surface form-section">
            <h2>{t("form.basics")}</h2>
            {errors.form ? <InlineNotice tone="danger">{errors.form}</InlineNotice> : null}
            <Field id={formFieldIds.name} label={t("form.name")} error={errors.name}>
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder={t("form.namePlaceholder")}
              />
            </Field>
            <SymbolPicker
              value={form.symbol}
              onChange={(symbol) => update("symbol", symbol)}
              {...symbolPicker}
              disabled={mutation.isPending || inlineResourceBusy}
            />
            <div className="field-row field-row--money">
              <Field id={formFieldIds.amount} label={t("form.amount")} error={errors.amount}>
                <input
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => update("amount", event.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field id={formFieldIds.currency} label={t("form.currency")} error={errors.currency}>
                <input
                  required
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) => update("currency", event.target.value.toUpperCase())}
                />
              </Field>
            </div>
          </section>

          <section className="surface form-section">
            <h2>{t("form.billingSchedule")}</h2>
            <div className="schedule-row">
              <span className="schedule-row__prefix">{t("form.every")}</span>
              <Field
                id={formFieldIds.recurrenceCount}
                label={t("form.every")}
                error={errors.recurrenceCount}
                className="field--count"
              >
                <input
                  type="number"
                  min={1}
                  max={1200}
                  inputMode="numeric"
                  value={form.recurrenceCount}
                  onChange={(event) => update("recurrenceCount", event.target.value)}
                />
              </Field>
              <Field
                id={formFieldIds.recurrenceUnit}
                label={t("form.unit")}
                error={errors.recurrenceUnit}
                className="field--unit"
              >
                <span className="select-wrap">
                  <select
                    id={formFieldIds.recurrenceUnit}
                    value={form.recurrenceUnit}
                    onChange={(event) =>
                      update("recurrenceUnit", event.target.value as RecurrenceUnit)
                    }
                  >
                    {(["day", "week", "month", "year"] as const).map((unit) => (
                      <option key={unit} value={unit}>
                        {t(`form.units.${unit}`)}
                      </option>
                    ))}
                  </select>
                  <IconChevronDown size={17} />
                </span>
              </Field>
            </div>
            <Field id={formFieldIds.anchorOn} label={t("form.anchorOn")} error={errors.anchorOn}>
              <input
                type="date"
                value={form.anchorOn}
                onChange={(event) => update("anchorOn", event.target.value)}
              />
            </Field>
            <div className="field-row">
              <ResourceAssociationField
                id={formFieldIds.categoryId ?? "subscription-category"}
                kind="category"
                userId={userId}
                value={categoryAssociationId}
                resources={categories}
                loading={categoriesLoading}
                error={categoriesError}
                validationError={errors.categoryId}
                disabled={mutation.isPending}
                onChange={(id) => update("categoryId", id)}
                onRetry={retryCategories}
                onPendingChange={setCategoryPending}
              />
              <ResourceAssociationField
                id={formFieldIds.paymentMethodId ?? "subscription-payment-method"}
                kind="payment-method"
                userId={userId}
                value={paymentMethodAssociationId}
                resources={paymentMethods}
                loading={paymentMethodsLoading}
                error={paymentMethodsError}
                validationError={errors.paymentMethodId}
                disabled={mutation.isPending}
                onChange={(id) => update("paymentMethodId", id)}
                onRetry={retryPaymentMethods}
                onPendingChange={setPaymentMethodPending}
              />
            </div>
          </section>

          {showReminderSection ? (
            <section className="surface form-section reminder-section">
              <div className="reminder-section__heading">
                <IconBell size={21} aria-hidden="true" />
                <div>
                  <h2>{t("form.emailReminder")}</h2>
                  <p>{t("form.emailReminderHelp")}</p>
                </div>
              </div>
              {emailRemindersAvailable ? (
                <>
                  {form.emailReminderEnabled && account.emailReminderSystemSuspended ? (
                    <InlineNotice tone="danger">{t("form.reminderSystemSuspended")}</InlineNotice>
                  ) : form.emailReminderEnabled && account.emailRemindersPaused ? (
                    <InlineNotice tone="warning">{t("form.remindersPaused")}</InlineNotice>
                  ) : null}
                  <label className="checkbox-field checkbox-field--prominent">
                    <input
                      id={formFieldIds.emailReminderEnabled}
                      type="checkbox"
                      checked={form.emailReminderEnabled}
                      disabled={mutation.isPending}
                      aria-invalid={errors.emailReminderEnabled ? true : undefined}
                      aria-describedby={
                        errors.emailReminderEnabled
                          ? `${formFieldIds.emailReminderEnabled}-error`
                          : undefined
                      }
                      onChange={(event) => update("emailReminderEnabled", event.target.checked)}
                    />
                    <span>
                      <strong>{t("form.enableEmailReminder")}</strong>
                      <small>{t("form.enableEmailReminderHint")}</small>
                    </span>
                  </label>
                  {errors.emailReminderEnabled ? (
                    <span
                      className="field__error"
                      id={`${formFieldIds.emailReminderEnabled}-error`}
                    >
                      {errors.emailReminderEnabled}
                    </span>
                  ) : null}

                  {form.emailReminderEnabled ? (
                    <div className="reminder-fields">
                      <Field
                        label={t("form.reminderDestination")}
                        hint={t("form.reminderDestinationHint")}
                      >
                        <p className="read-only-value">{account.email}</p>
                      </Field>
                      <fieldset className="choice-fieldset">
                        <legend>{t("form.reminderLeadTime")}</legend>
                        <label>
                          <input
                            type="radio"
                            name="emailReminderLeadMode"
                            checked={!reminderLeadIsCustom}
                            onChange={() => update("emailReminderDaysBefore", "")}
                          />
                          <span>
                            <strong>
                              {t("form.useAccountReminderDefault", {
                                count: account.defaultEmailReminderDaysBefore,
                              })}
                            </strong>
                            <small>{t("form.inheritsReminderDefault")}</small>
                          </span>
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="emailReminderLeadMode"
                            checked={reminderLeadIsCustom}
                            onChange={() =>
                              update(
                                "emailReminderDaysBefore",
                                String(account.defaultEmailReminderDaysBefore),
                              )
                            }
                          />
                          <span>
                            <strong>{t("form.useCustomReminderLead")}</strong>
                            <small>{t("form.customReminderLeadHint")}</small>
                          </span>
                        </label>
                      </fieldset>
                      {reminderLeadIsCustom ? (
                        <Field
                          id={formFieldIds.emailReminderDaysBefore}
                          label={t("form.reminderDaysBefore")}
                          hint={t("form.reminderDaysBeforeHint")}
                          error={errors.emailReminderDaysBefore}
                        >
                          <input
                            type="number"
                            min={0}
                            max={365}
                            inputMode="numeric"
                            value={form.emailReminderDaysBefore}
                            onChange={(event) =>
                              update("emailReminderDaysBefore", event.target.value)
                            }
                          />
                        </Field>
                      ) : null}
                      {reminderPreview ? (
                        <div className="reminder-preview" role="status">
                          <strong>{t("form.reminderPreviewTitle")}</strong>
                          <p>
                            {t("form.reminderPreview", {
                              reminderDate: formatDate(reminderPreview.planningOn, i18n.language),
                              localTime: account.emailReminderLocalTime,
                              timeZone: account.timezone,
                              billingDate: formatDate(reminderPreview.billingOn, i18n.language),
                            })}
                          </p>
                          <small>{t("form.reminderEstimateDisclaimer")}</small>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="reminder-section__saved-state">
                  <p role="status">
                    {form.emailReminderEnabled
                      ? t("form.savedReminderUnavailable")
                      : t("form.reminderWillTurnOff")}
                  </p>
                  {form.emailReminderEnabled ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => update("emailReminderEnabled", false)}
                      disabled={mutation.isPending}
                    >
                      {t("form.turnOffReminder")}
                    </Button>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          <section className="surface form-section form-section--advanced">
            <details>
              <summary>{t("form.advanced")}</summary>
              <div className="advanced-fields">
                {form.recurrenceUnit === "month" ? (
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={form.endOfMonth}
                      onChange={(event) => update("endOfMonth", event.target.checked)}
                    />
                    <span>
                      <strong>{t("form.endOfMonth")}</strong>
                      <small>{t("form.endOfMonthHelp")}</small>
                    </span>
                  </label>
                ) : null}
                <Field
                  id={formFieldIds.websiteUrl}
                  label={t("form.website")}
                  error={errors.websiteUrl}
                >
                  <input
                    type="url"
                    value={form.websiteUrl}
                    onChange={(event) => update("websiteUrl", event.target.value)}
                    placeholder={t("form.websitePlaceholder")}
                  />
                </Field>
                <Field id={formFieldIds.notes} label={t("form.notes")} error={errors.notes}>
                  <textarea
                    maxLength={10_000}
                    rows={5}
                    value={form.notes}
                    onChange={(event) => update("notes", event.target.value)}
                    placeholder={t("form.notesPlaceholder")}
                  />
                </Field>
              </div>
            </details>
          </section>
        </div>

        <aside className="surface schedule-preview">
          <div className="summary-label">
            <IconCalendarEvent size={20} />
            {t("form.nextCharges")}
          </div>
          {occurrences.length ? (
            <ol>
              {occurrences.map((date) => (
                <li key={date}>{formatDate(date, i18n.language)}</li>
              ))}
            </ol>
          ) : (
            <p>{t("form.previewHelp")}</p>
          )}
        </aside>

        <footer className="form-actions">
          {Object.keys(errors).length ? <p role="alert">{t("form.invalidSummary")}</p> : <span />}
          <div>
            <Link className="button button--secondary" to={backTo}>
              {t("app.cancel")}
            </Link>
            <Button type="submit" disabled={mutation.isPending || inlineResourceBusy}>
              {mutation.isPending
                ? t("app.saving")
                : isEditing
                  ? t("form.update")
                  : t("form.create")}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}

export function SubscriptionFormPage() {
  const { subscriptionId } = useParams();
  const [searchParams] = useSearchParams();
  const isEditing = Boolean(subscriptionId);
  const sessionQuery = useQuery({ queryKey: sessionQueryKey, queryFn: api.session });
  const userId = sessionQuery.data?.user.id ?? "pending";
  const subscriptionQuery = useQuery({
    queryKey: ["subscription", subscriptionId],
    queryFn: () => api.subscription(subscriptionId ?? ""),
    enabled: isEditing,
  });
  const [categoriesQuery, paymentMethodsQuery, meQuery] = useQueries({
    queries: [
      {
        queryKey: categoriesQueryKey(userId),
        queryFn: api.categories,
        enabled: Boolean(sessionQuery.data),
      },
      {
        queryKey: paymentMethodsQueryKey(userId),
        queryFn: api.paymentMethods,
        enabled: Boolean(sessionQuery.data),
      },
      { queryKey: ["me"], queryFn: api.me },
    ],
  });

  if (sessionQuery.isPending || meQuery.isPending || (isEditing && subscriptionQuery.isPending)) {
    return <LoadingPage variant="form" />;
  }
  if (isEditing && subscriptionQuery.isError) {
    return (
      <QueryError
        error={subscriptionQuery.error}
        onRetry={() => void subscriptionQuery.refetch()}
      />
    );
  }
  if (sessionQuery.isError) {
    return <QueryError error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />;
  }
  const supportingError = meQuery.error;
  if (supportingError) {
    return <QueryError error={supportingError} />;
  }

  const backTo = isEditing
    ? `/subscriptions/${subscriptionId}`
    : safeReturnDestination(searchParams.get("from"));

  return (
    <SubscriptionFormEditor
      key={subscriptionQuery.data?.updatedAt ?? "new"}
      subscriptionId={subscriptionId}
      subscription={subscriptionQuery.data}
      categories={categoriesQuery.data ?? []}
      paymentMethods={paymentMethodsQuery.data ?? []}
      categoriesLoading={categoriesQuery.isPending}
      paymentMethodsLoading={paymentMethodsQuery.isPending}
      categoriesError={categoriesQuery.error}
      paymentMethodsError={paymentMethodsQuery.error}
      retryCategories={() => void categoriesQuery.refetch()}
      retryPaymentMethods={() => void paymentMethodsQuery.refetch()}
      userId={sessionQuery.data.user.id}
      account={meQuery.data}
      emailRemindersAvailable={sessionQuery.data.capabilities.emailReminders}
      backTo={backTo}
    />
  );
}

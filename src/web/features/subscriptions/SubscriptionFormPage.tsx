import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft, IconCalendarEvent, IconChevronDown } from "@tabler/icons-react";
import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import { COMMON_ICON_KEYS, type CommonIconKey, type ResourceSymbol } from "../../../domain/symbol";
import type {
  Category,
  PaymentMethod,
  RecurrenceUnit,
  Subscription,
  SubscriptionInput,
} from "../../api/types";
import { Button, Field, InlineNotice, LoadingPage, QueryError } from "../../components/ui";
import { SymbolPicker } from "../../components/SymbolPicker";
import { formatDate, previewOccurrences } from "../../utils/format";

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
  websiteUrl: "subscription-website-url",
  notes: "subscription-notes",
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
  reportingCurrency: string;
  backTo: string;
};

function SubscriptionFormEditor({
  subscriptionId,
  subscription,
  categories,
  paymentMethods,
  reportingCurrency,
  backTo,
}: SubscriptionFormEditorProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = Boolean(subscriptionId);
  const [form, setForm] = useState<FormState>(() =>
    subscription
      ? stateFromSubscription(subscription)
      : { ...initialState(), currency: reportingCurrency },
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const iconLabels = useMemo(
    () =>
      Object.fromEntries(COMMON_ICON_KEYS.map((key) => [key, t(`symbols.icons.${key}`)])) as Record<
        CommonIconKey,
        string
      >,
    [t],
  );
  const emojiOptions = useMemo(
    () =>
      [
        ["⭐", "star"],
        ["🎬", "movie"],
        ["🎵", "music"],
        ["☁️", "cloud"],
        ["💳", "card"],
        ["🧾", "receipt"],
        ["✈️", "travel"],
        ["🛠️", "tools"],
      ].map(([value, key]) => ({ value: value ?? "", label: t(`symbols.emojis.${key}`) })),
    [t],
  );

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
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      focusFirstInvalidField(validationErrors);
      return;
    }
    mutation.mutate(toInput(form));
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
              iconLabels={iconLabels}
              emojiOptions={emojiOptions}
              labels={{
                legend: t("symbols.legend"),
                commonIcons: t("symbols.commonIcons"),
                emoji: t("symbols.emoji"),
                emojiInput: t("symbols.emojiInput"),
                emojiInputPlaceholder: t("symbols.emojiInputPlaceholder"),
                invalidEmoji: t("symbols.invalidEmoji"),
                clear: t("symbols.clear"),
              }}
              disabled={mutation.isPending}
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
              <Field
                id={formFieldIds.categoryId}
                label={t("form.category")}
                error={errors.categoryId}
              >
                <span className="select-wrap">
                  <select
                    id={formFieldIds.categoryId}
                    value={form.categoryId}
                    onChange={(event) => update("categoryId", event.target.value)}
                  >
                    <option value="">{t("form.none")}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <IconChevronDown size={17} />
                </span>
              </Field>
              <Field
                id={formFieldIds.paymentMethodId}
                label={t("form.paymentMethod")}
                error={errors.paymentMethodId}
              >
                <span className="select-wrap">
                  <select
                    id={formFieldIds.paymentMethodId}
                    value={form.paymentMethodId}
                    onChange={(event) => update("paymentMethodId", event.target.value)}
                  >
                    <option value="">{t("form.none")}</option>
                    {paymentMethods.map((payment) => (
                      <option key={payment.id} value={payment.id}>
                        {payment.name}
                      </option>
                    ))}
                  </select>
                  <IconChevronDown size={17} />
                </span>
              </Field>
            </div>
          </section>

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
            <Button type="submit" disabled={mutation.isPending}>
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
  const subscriptionQuery = useQuery({
    queryKey: ["subscription", subscriptionId],
    queryFn: () => api.subscription(subscriptionId ?? ""),
    enabled: isEditing,
  });
  const [categoriesQuery, paymentMethodsQuery, meQuery] = useQueries({
    queries: [
      { queryKey: ["categories"], queryFn: api.categories },
      { queryKey: ["payment-methods"], queryFn: api.paymentMethods },
      { queryKey: ["me"], queryFn: api.me },
    ],
  });

  if (
    categoriesQuery.isPending ||
    paymentMethodsQuery.isPending ||
    meQuery.isPending ||
    (isEditing && subscriptionQuery.isPending)
  ) {
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
  const supportingError = categoriesQuery.error ?? paymentMethodsQuery.error ?? meQuery.error;
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
      reportingCurrency={meQuery.data?.reportingCurrency ?? "USD"}
      backTo={backTo}
    />
  );
}

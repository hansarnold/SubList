import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCategory,
  IconChevronDown,
  IconCreditCard,
  IconDatabaseExport,
  IconDatabaseImport,
  IconLanguage,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { categoriesQueryKey, paymentMethodsQueryKey } from "../../api/query-keys";
import { useSessionUserId } from "../../api/session";
import type {
  Category as CategoryType,
  ImportResult,
  PaymentMethod,
  PaymentMethodKind,
  ResourceSymbol,
  Session,
  User,
} from "../../api/types";
import { CategorySymbol, PaymentMethodSymbol } from "../../components/ResourceSymbol";
import {
  CategoryEditorFields,
  PaymentMethodEditorFields,
} from "../../components/ResourceEditorFields";
import { Button, Dialog, Field, InlineNotice, LoadingPage, QueryError } from "../../components/ui";
import { normalizeCategoryNameKey } from "../../../domain/text-normalization";
import { CATEGORY_PRESETS, PAYMENT_METHOD_PRESETS } from "../../../shared/presets";
import { setLanguage } from "../../i18n";

const settingsNav = [
  { to: "/settings/profile", key: "settings.profile", icon: IconUserCircle },
  { to: "/settings/categories", key: "settings.categories", icon: IconCategory },
  { to: "/settings/payment-methods", key: "settings.paymentMethods", icon: IconCreditCard },
  { to: "/settings/data", key: "settings.data", icon: IconDatabaseExport },
] as const;

function formString(values: FormData, name: string, fallback = "") {
  const value = values.get(name);
  return typeof value === "string" ? value : fallback;
}

function safeSettingsReturnDestination(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const parsed = new URL(value, "https://opensublists.invalid");
    if (parsed.origin !== "https://opensublists.invalid" || parsed.hash) return null;
    if (`${parsed.pathname}${parsed.search}` !== value) return null;
    const isSubscriptionForm =
      parsed.pathname === "/subscriptions/new" ||
      /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/i.test(
        parsed.pathname,
      );
    return isSubscriptionForm ? value : null;
  } catch {
    return null;
  }
}

export function SettingsLayout() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const returnTo = safeSettingsReturnDestination(searchParams.get("from"));
  const returnSearch = returnTo ? `?from=${encodeURIComponent(returnTo)}` : "";
  return (
    <div className="page page--settings">
      <header className="page-header">
        <div>
          {returnTo ? (
            <Link className="back-link" to={returnTo}>
              <IconArrowLeft size={19} aria-hidden="true" />
              {t("app.back")}
            </Link>
          ) : null}
          <p className="page-eyebrow">{t("app.name")}</p>
          <h1>{t("settings.title")}</h1>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings.title")}>
          {settingsNav.map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={`${to}${returnSearch}`}
              className={({ isActive }) => (isActive ? "is-active" : "")}
            >
              <Icon size={19} />
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="settings-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export function ProfileSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["me"], queryFn: api.me });
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: api.session });
  const [interfaceLocaleDraft, setInterfaceLocaleDraft] = useState<User["interfaceLocale"] | null>(
    null,
  );
  const [emailLocaleDraft, setEmailLocaleDraft] = useState<User["emailLocale"] | null>(null);
  const [emailRemindersPausedDraft, setEmailRemindersPausedDraft] = useState<boolean | null>(null);
  const mutation = useMutation({
    mutationFn: api.updateMe,
    onSuccess: async (user) => {
      queryClient.setQueryData(["me"], user);
      queryClient.setQueryData<Session | undefined>(["session"], (current) =>
        current ? { ...current, user } : current,
      );
      setInterfaceLocaleDraft(null);
      setEmailLocaleDraft(null);
      setEmailRemindersPausedDraft(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  if (query.isPending || sessionQuery.isPending) return <LoadingPage variant="form" />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  if (sessionQuery.isError) {
    return <QueryError error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />;
  }

  const user = query.data;
  const interfaceLocale = interfaceLocaleDraft ?? user.interfaceLocale;
  const emailLocale = emailLocaleDraft ?? user.emailLocale;
  const emailRemindersPaused = emailRemindersPausedDraft ?? user.emailRemindersPaused;
  const isLocalEnvironment = sessionQuery.data.environment === "local";
  const emailRemindersAvailable = sessionQuery.data.capabilities.emailReminders;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutation.mutate({
      displayName: formString(values, "displayName").trim() || null,
      timezone: formString(values, "timezone", user.timezone),
      reportingCurrency: formString(
        values,
        "reportingCurrency",
        user.reportingCurrency,
      ).toUpperCase(),
      interfaceLocale,
      emailLocale,
      defaultEmailReminderDaysBefore: Number(
        formString(
          values,
          "defaultEmailReminderDaysBefore",
          String(user.defaultEmailReminderDaysBefore),
        ),
      ),
      emailReminderLocalTime: formString(
        values,
        "emailReminderLocalTime",
        user.emailReminderLocalTime,
      ),
      emailRemindersPaused,
    });
  }

  return (
    <section className="surface settings-panel">
      <header className="settings-panel__header">
        <div>
          <h2>{t("settings.profile")}</h2>
          <p>{t("settings.profileIntro")}</p>
        </div>
      </header>
      {mutation.isError ? (
        <InlineNotice tone="danger">{mutation.error.message}</InlineNotice>
      ) : null}
      <form className="settings-form" onSubmit={submit}>
        <div className="field">
          <span className="field__label">{t("settings.email")}</span>
          <p className="read-only-value">{user.email}</p>
        </div>
        <Field label={t("settings.displayName")}>
          <input name="displayName" maxLength={120} defaultValue={user.displayName ?? ""} />
        </Field>
        <div className="field-row">
          <Field label={t("settings.timezone")} hint={t("settings.timezoneWarning")}>
            <input name="timezone" defaultValue={user.timezone} required />
          </Field>
          <Field label={t("settings.reportingCurrency")}>
            <input
              name="reportingCurrency"
              maxLength={3}
              pattern="[A-Za-z]{3}"
              defaultValue={user.reportingCurrency}
              required
            />
          </Field>
        </div>
        {emailRemindersAvailable ? (
          <fieldset className="settings-reminders">
            <legend>{t("settings.renewalEmailSettings")}</legend>
            <p>{t("settings.renewalEmailSettingsHelp")}</p>
            <div className="field-row">
              <Field
                label={t("settings.defaultReminderDays")}
                hint={t("settings.defaultReminderDaysHint")}
              >
                <input
                  name="defaultEmailReminderDaysBefore"
                  type="number"
                  min={0}
                  max={365}
                  inputMode="numeric"
                  defaultValue={user.defaultEmailReminderDaysBefore}
                  required
                />
              </Field>
              <Field
                label={t("settings.reminderLocalTime")}
                hint={t("settings.reminderLocalTimeHint", { timeZone: user.timezone })}
              >
                <span className="select-wrap">
                  <select name="emailReminderLocalTime" defaultValue={user.emailReminderLocalTime}>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const value = `${String(hour).padStart(2, "0")}:00`;
                      return (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      );
                    })}
                  </select>
                  <IconChevronDown size={17} />
                </span>
              </Field>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={emailRemindersPaused}
                disabled={
                  user.emailRemindersPaused &&
                  (!emailRemindersAvailable || user.emailReminderSystemSuspended)
                }
                onChange={(event) => setEmailRemindersPausedDraft(event.target.checked)}
              />
              <span>
                <strong>{t("settings.pauseAllReminders")}</strong>
                <small>{t("settings.pauseAllRemindersHint")}</small>
              </span>
            </label>
          </fieldset>
        ) : null}

        <div className="settings-language settings-language--in-form">
          <div className="settings-language__intro">
            <IconLanguage size={21} aria-hidden="true" />
            <div>
              <h3>{t("settings.languageAndAppearance")}</h3>
              <p>{t("settings.languagePreferencesHint")}</p>
            </div>
          </div>
          <div className="settings-language__fields">
            <Field label={t("settings.interfaceLanguage")}>
              <span className="select-wrap">
                <select
                  name="interfaceLocale"
                  value={interfaceLocale}
                  onChange={(event) => {
                    const locale = event.target.value as User["interfaceLocale"];
                    setInterfaceLocaleDraft(locale);
                    void setLanguage(locale);
                  }}
                >
                  <option value="en">{t("app.english")}</option>
                  <option value="zh-Hans">{t("app.chinese")}</option>
                </select>
                <IconChevronDown size={17} />
              </span>
            </Field>
            <Field label={t("settings.emailLanguage")} hint={t("settings.emailLanguageHint")}>
              <span className="select-wrap">
                <select
                  name="emailLocale"
                  value={emailLocale}
                  onChange={(event) =>
                    setEmailLocaleDraft(event.target.value as User["emailLocale"])
                  }
                >
                  <option value="en">{t("app.english")}</option>
                  <option value="zh-Hans">{t("app.chinese")}</option>
                </select>
                <IconChevronDown size={17} />
              </span>
            </Field>
          </div>
        </div>
        <div className="settings-form__actions">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t("app.saving") : t("app.save")}
          </Button>
        </div>
      </form>

      <div className="settings-signout">
        <div>
          <h3>{t("settings.signOut")}</h3>
          <p>
            {isLocalEnvironment
              ? t("settings.localSignOutUnavailable")
              : t("settings.signOutDescription")}
          </p>
        </div>
        {isLocalEnvironment ? null : (
          <a className="button button--secondary" href="/cdn-cgi/access/logout">
            {t("settings.signOut")}
          </a>
        )}
      </div>
    </section>
  );
}

function SettingsEditorDialog({
  title,
  busy,
  returnFocusTo,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      window.requestAnimationFrame(() => returnFocusTo?.focus());
    };
  }, [returnFocusTo]);

  function handleBackdropPointer(event: MouseEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside && !busy) onClose();
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="dialog resource-settings-dialog"
      aria-labelledby={titleId}
      onMouseDown={handleBackdropPointer}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        type="button"
        className="icon-button dialog__close"
        aria-label={t("app.close")}
        onClick={onClose}
        disabled={busy}
      >
        <IconX size={20} />
      </button>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>,
    document.body,
  );
}

export function CategorySettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const userId = useSessionUserId();
  const query = useQuery({
    queryKey: categoriesQueryKey(userId),
    queryFn: api.categories,
    enabled: userId !== "pending",
  });
  const [draft, setDraft] = useState<{
    stage: "choices" | "editor";
    editing: CategoryType | null;
    name: string;
    color: string;
    symbol: ResourceSymbol;
    revision: number;
    returnFocusTo: HTMLElement | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<CategoryType | null>(null);
  const [commonSearch, setCommonSearch] = useState("");
  const mutation = useMutation({
    mutationFn: ({
      id,
      name,
      color,
      symbol,
      position,
    }: {
      id: string | undefined;
      name: string;
      color: string;
      symbol: ResourceSymbol;
      position: number;
    }) =>
      id
        ? api.updateCategory(id, { name, color, symbol, position })
        : api.createCategory({ name, color, symbol, position }),
    onSuccess: async () => {
      setDraft(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: categoriesQueryKey(userId) }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: async () => {
      setDeleting(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: categoriesQueryKey(userId) }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  if (query.isPending) return <LoadingPage variant="form" />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const categories = query.data;
  const existingNames = new Set(
    categories.map((category) => normalizeCategoryNameKey(category.name)),
  );
  const commonCategories = CATEGORY_PRESETS.filter(
    (preset) => !existingNames.has(normalizeCategoryNameKey(t(preset.labelKey))),
  );
  const normalizedCommonSearch = commonSearch.trim().toLocaleLowerCase();
  const visibleCommonCategories = normalizedCommonSearch
    ? commonCategories.filter((preset) =>
        t(preset.labelKey).toLocaleLowerCase().includes(normalizedCommonSearch),
      )
    : commonCategories;
  const showCommonSearch = categories.length + commonCategories.length > 10;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || draft.stage !== "editor") return;
    const values = new FormData(event.currentTarget);
    mutation.mutate({
      id: draft.editing?.id,
      name: formString(values, "name"),
      color: formString(values, "color", draft.color),
      symbol: draft.symbol,
      position: draft.editing?.position ?? categories.length,
    });
  }

  function openAddDialog() {
    mutation.reset();
    setCommonSearch("");
    setDraft({
      stage: "choices",
      editing: null,
      name: "",
      color: "#3b82f6",
      symbol: null,
      revision: 0,
      returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  }

  function startEditing(category: CategoryType) {
    mutation.reset();
    setDraft({
      stage: "editor",
      editing: category,
      name: category.name,
      color: category.color,
      symbol: category.symbol,
      revision: 0,
      returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  }

  function openBlankEditor() {
    setDraft((current) =>
      current
        ? {
            ...current,
            stage: "editor",
            name: "",
            color: "#3b82f6",
            symbol: null,
            revision: current.revision + 1,
          }
        : current,
    );
  }

  return (
    <section className="surface settings-panel">
      <header className="settings-panel__header">
        <div>
          <h2>{t("settings.categories")}</h2>
          <p>{t("settings.categoriesIntro")}</p>
        </div>
        <Button type="button" onClick={openAddDialog}>
          <IconPlus size={18} aria-hidden="true" />
          {t("settings.addCategory")}
        </Button>
      </header>
      {deleteMutation.isError ? (
        <InlineNotice tone="danger">{deleteMutation.error.message}</InlineNotice>
      ) : null}
      <div className="resource-list resource-list--saved">
        {categories.length ? (
          categories.map((category) => (
            <div className="resource-row" key={category.id}>
              <span className="resource-row__identity">
                <CategorySymbol symbol={category.symbol} color={category.color} size={22} />
                <strong>{category.name}</strong>
              </span>
              <div className="resource-row__actions">
                <Button variant="ghost" onClick={() => startEditing(category)}>
                  {t("app.edit")}
                </Button>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  aria-label={`${t("app.delete")} ${category.name}`}
                  onClick={() => setDeleting(category)}
                >
                  <IconTrash size={18} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="resource-empty">{t("settings.noCategories")}</p>
        )}
      </div>
      {draft ? (
        <SettingsEditorDialog
          title={draft.editing ? t("settings.editCategory") : t("settings.addCategory")}
          busy={mutation.isPending}
          returnFocusTo={draft.returnFocusTo}
          onClose={() => {
            if (!mutation.isPending) setDraft(null);
          }}
        >
          {draft.stage === "choices" ? (
            <div className="resource-settings-dialog__choices">
              <p>{t("settings.chooseCategoryStart")}</p>
              {commonCategories.length ? (
                <section aria-labelledby="common-categories-title">
                  <h3 id="common-categories-title">
                    <IconSparkles size={17} aria-hidden="true" />
                    {t("form.commonCategories")}
                  </h3>
                  {showCommonSearch ? (
                    <label className="resource-association__search">
                      <IconSearch size={17} aria-hidden="true" />
                      <span className="visually-hidden">{t("form.searchCommonCategories")}</span>
                      <input
                        type="search"
                        value={commonSearch}
                        onChange={(event) => setCommonSearch(event.target.value)}
                        placeholder={t("form.searchCommonCategories")}
                        autoFocus
                      />
                    </label>
                  ) : null}
                  <div className="resource-suggestion-grid">
                    {visibleCommonCategories.map((preset) => (
                      <button
                        type="button"
                        key={preset.key}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  stage: "editor",
                                  name: t(preset.labelKey),
                                  color: preset.color,
                                  symbol: preset.symbol,
                                  revision: current.revision + 1,
                                }
                              : current,
                          )
                        }
                      >
                        <CategorySymbol symbol={preset.symbol} color={preset.color} size={21} />
                        <span>{t(preset.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                  {normalizedCommonSearch && visibleCommonCategories.length === 0 ? (
                    <p className="resource-empty">{t("form.noCommonMatches")}</p>
                  ) : null}
                </section>
              ) : null}
              <Button type="button" variant="secondary" onClick={openBlankEditor}>
                <IconPlus size={18} aria-hidden="true" />
                {t("form.createCategory")}
              </Button>
            </div>
          ) : (
            <form className="resource-settings-dialog__form" onSubmit={submit} key={draft.revision}>
              {mutation.isError ? (
                <InlineNotice tone="danger">{mutation.error.message}</InlineNotice>
              ) : null}
              <CategoryEditorFields
                defaultName={draft.name}
                defaultColor={draft.color}
                symbol={draft.symbol}
                onSymbolChange={(symbol) =>
                  setDraft((current) => (current ? { ...current, symbol } : current))
                }
                disabled={mutation.isPending}
                autoFocus
              />
              <div className="dialog__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDraft(null)}
                  disabled={mutation.isPending}
                >
                  {t("app.cancel")}
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending
                    ? t("app.saving")
                    : draft.editing
                      ? t("app.save")
                      : t("settings.addCategory")}
                </Button>
              </div>
            </form>
          )}
        </SettingsEditorDialog>
      ) : null}
      <Dialog
        open={Boolean(deleting)}
        title={t("settings.deleteCategoryTitle", { name: deleting?.name })}
        body={t("settings.deleteCategoryBody")}
        confirmLabel={t("app.delete")}
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

export function PaymentMethodSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const userId = useSessionUserId();
  const query = useQuery({
    queryKey: paymentMethodsQueryKey(userId),
    queryFn: api.paymentMethods,
    enabled: userId !== "pending",
  });
  const [draft, setDraft] = useState<{
    stage: "choices" | "editor";
    editing: PaymentMethod | null;
    name: string;
    kind: PaymentMethodKind;
    label: string;
    symbol: ResourceSymbol;
    revision: number;
    returnFocusTo: HTMLElement | null;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [commonSearch, setCommonSearch] = useState("");
  const deleting = query.data?.find((payment) => payment.id === deletingId) ?? null;
  const mutation = useMutation({
    mutationFn: (input: {
      id: string | undefined;
      name: string;
      kind: PaymentMethodKind;
      label: string | null;
      symbol: ResourceSymbol;
      position: number;
    }) =>
      input.id
        ? api.updatePaymentMethod(input.id, {
            name: input.name,
            kind: input.kind,
            label: input.label,
            symbol: input.symbol,
            position: input.position,
          })
        : api.createPaymentMethod({
            name: input.name,
            kind: input.kind,
            label: input.label,
            symbol: input.symbol,
            position: input.position,
          }),
    onSuccess: async () => {
      setDraft(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: paymentMethodsQueryKey(userId) }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: api.deletePaymentMethod,
    onSuccess: async () => {
      setDeletingId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: paymentMethodsQueryKey(userId) }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  if (query.isPending) return <LoadingPage variant="form" />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const paymentMethods = query.data;
  const existingNames = new Set(
    paymentMethods.map((paymentMethod) => normalizeCategoryNameKey(paymentMethod.name)),
  );
  const commonPaymentMethods = PAYMENT_METHOD_PRESETS.filter(
    (preset) => !existingNames.has(normalizeCategoryNameKey(t(preset.labelKey))),
  );
  const normalizedCommonSearch = commonSearch.trim().toLocaleLowerCase();
  const visibleCommonPaymentMethods = normalizedCommonSearch
    ? commonPaymentMethods.filter((preset) =>
        t(preset.labelKey).toLocaleLowerCase().includes(normalizedCommonSearch),
      )
    : commonPaymentMethods;
  const showCommonSearch = paymentMethods.length + commonPaymentMethods.length > 10;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || draft.stage !== "editor") return;
    const values = new FormData(event.currentTarget);
    mutation.mutate({
      id: draft.editing?.id,
      name: formString(values, "name"),
      kind: formString(values, "kind", draft.kind) as PaymentMethodKind,
      label: formString(values, "label").trim() || null,
      symbol: draft.symbol,
      position: draft.editing?.position ?? paymentMethods.length,
    });
  }

  function openAddDialog() {
    mutation.reset();
    setCommonSearch("");
    setDraft({
      stage: "choices",
      editing: null,
      name: "",
      kind: "card",
      label: "",
      symbol: null,
      revision: 0,
      returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  }

  function startEditing(id: string) {
    const paymentMethod = paymentMethods.find((payment) => payment.id === id);
    if (!paymentMethod) return;
    mutation.reset();
    setDraft({
      stage: "editor",
      editing: paymentMethod,
      name: paymentMethod.name,
      kind: paymentMethod.kind,
      label: paymentMethod.label ?? "",
      symbol: paymentMethod.symbol,
      revision: 0,
      returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  }

  return (
    <section className="surface settings-panel">
      <header className="settings-panel__header">
        <div>
          <h2>{t("settings.paymentMethods")}</h2>
          <p>{t("settings.paymentIntro")}</p>
        </div>
        <Button type="button" onClick={openAddDialog}>
          <IconPlus size={18} aria-hidden="true" />
          {t("settings.addPaymentMethod")}
        </Button>
      </header>
      {deleteMutation.isError ? (
        <InlineNotice tone="danger">{deleteMutation.error.message}</InlineNotice>
      ) : null}
      <div className="resource-list resource-list--saved">
        {paymentMethods.length ? (
          paymentMethods.map((payment) => (
            <div className="resource-row" key={payment.id}>
              <span className="payment-display">
                <PaymentMethodSymbol symbol={payment.symbol} kind={payment.kind} size={20} />
                <span>
                  <strong>{payment.name}</strong>
                  <small>
                    {[t(`settings.kinds.${payment.kind}`), payment.label]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </span>
              <div className="resource-row__actions">
                <Button variant="ghost" onClick={() => startEditing(payment.id)}>
                  {t("app.edit")}
                </Button>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  aria-label={`${t("app.delete")} ${payment.name}`}
                  onClick={() => setDeletingId(payment.id)}
                >
                  <IconTrash size={18} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="resource-empty">{t("settings.noPaymentMethods")}</p>
        )}
      </div>
      {draft ? (
        <SettingsEditorDialog
          title={draft.editing ? t("settings.editPaymentMethod") : t("settings.addPaymentMethod")}
          busy={mutation.isPending}
          returnFocusTo={draft.returnFocusTo}
          onClose={() => {
            if (!mutation.isPending) setDraft(null);
          }}
        >
          {draft.stage === "choices" ? (
            <div className="resource-settings-dialog__choices">
              <p>{t("settings.choosePaymentMethodStart")}</p>
              {commonPaymentMethods.length ? (
                <section aria-labelledby="common-payment-methods-title">
                  <h3 id="common-payment-methods-title">
                    <IconSparkles size={17} aria-hidden="true" />
                    {t("form.commonPaymentMethods")}
                  </h3>
                  {showCommonSearch ? (
                    <label className="resource-association__search">
                      <IconSearch size={17} aria-hidden="true" />
                      <span className="visually-hidden">
                        {t("form.searchCommonPaymentMethods")}
                      </span>
                      <input
                        type="search"
                        value={commonSearch}
                        onChange={(event) => setCommonSearch(event.target.value)}
                        placeholder={t("form.searchCommonPaymentMethods")}
                        autoFocus
                      />
                    </label>
                  ) : null}
                  <div className="resource-suggestion-grid">
                    {visibleCommonPaymentMethods.map((preset) => (
                      <button
                        type="button"
                        key={preset.key}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  stage: "editor",
                                  name: t(preset.labelKey),
                                  kind: preset.kind,
                                  symbol: preset.symbol,
                                  revision: current.revision + 1,
                                }
                              : current,
                          )
                        }
                      >
                        <PaymentMethodSymbol symbol={preset.symbol} kind={preset.kind} size={21} />
                        <span>{t(preset.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                  {normalizedCommonSearch && visibleCommonPaymentMethods.length === 0 ? (
                    <p className="resource-empty">{t("form.noCommonMatches")}</p>
                  ) : null}
                </section>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          stage: "editor",
                          name: "",
                          kind: "card",
                          label: "",
                          symbol: null,
                          revision: current.revision + 1,
                        }
                      : current,
                  )
                }
              >
                <IconPlus size={18} aria-hidden="true" />
                {t("form.createPaymentMethod")}
              </Button>
            </div>
          ) : (
            <form className="resource-settings-dialog__form" onSubmit={submit} key={draft.revision}>
              {mutation.isError ? (
                <InlineNotice tone="danger">{mutation.error.message}</InlineNotice>
              ) : null}
              <PaymentMethodEditorFields
                defaultName={draft.name}
                defaultKind={draft.kind}
                defaultLabel={draft.label}
                symbol={draft.symbol}
                onSymbolChange={(symbol) =>
                  setDraft((current) => (current ? { ...current, symbol } : current))
                }
                disabled={mutation.isPending}
                autoFocus
              />
              <div className="dialog__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDraft(null)}
                  disabled={mutation.isPending}
                >
                  {t("app.cancel")}
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending
                    ? t("app.saving")
                    : draft.editing
                      ? t("app.save")
                      : t("settings.addPaymentMethod")}
                </Button>
              </div>
            </form>
          )}
        </SettingsEditorDialog>
      ) : null}
      <Dialog
        open={Boolean(deleting)}
        title={t("settings.deletePaymentTitle", { name: deleting?.name })}
        body={t("settings.deletePaymentBody")}
        confirmLabel={t("app.delete")}
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onClose={() => setDeletingId(null)}
      />
    </section>
  );
}

export function DataSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [archive, setArchive] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<"skip" | "overwrite" | "duplicate">("skip");
  const [importProfile, setImportProfile] = useState(false);
  const previewMutation = useMutation({ mutationFn: api.previewImport });
  const importMutation = useMutation({
    mutationFn: () =>
      api.confirmImport({
        archive,
        expectedDigest: previewMutation.data?.digest ?? "",
        conflictStrategy: strategy,
        importProfile,
        confirmed: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  async function selectFile(file: File | undefined) {
    setFileError(null);
    setArchive(null);
    setFileName("");
    previewMutation.reset();
    importMutation.reset();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFileError(t("settings.archiveTooLarge"));
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      setArchive(parsed);
      setFileName(file.name);
    } catch {
      setFileError(t("settings.invalidArchive"));
    }
  }

  function changeStrategy(next: typeof strategy) {
    setStrategy(next);
    previewMutation.reset();
    importMutation.reset();
  }

  function changeImportProfile(next: boolean) {
    setImportProfile(next);
    previewMutation.reset();
    importMutation.reset();
  }

  const preview = previewMutation.data;
  return (
    <div className="data-settings">
      <section className="surface settings-panel data-card">
        <span className="data-card__icon">
          <IconDatabaseExport size={23} />
        </span>
        <div>
          <h2>{t("settings.exportTitle")}</h2>
          <p>{t("settings.exportBody")}</p>
        </div>
        <a className="button button--secondary" href="/api/v1/export" download>
          <IconDatabaseExport size={18} />
          {t("settings.exportButton")}
        </a>
      </section>
      <section className="surface settings-panel data-card data-card--import">
        <span className="data-card__icon">
          <IconDatabaseImport size={23} />
        </span>
        <div>
          <h2>{t("settings.importTitle")}</h2>
          <p>{t("settings.importBody")}</p>
        </div>
        <InlineNotice>
          <IconAlertTriangle size={19} />
          {t("settings.privacyWarning")}
        </InlineNotice>
        <label className="file-picker">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
          <span className="button button--secondary">{t("settings.selectFile")}</span>
          <small>{fileName}</small>
        </label>
        {fileError ? <InlineNotice tone="danger">{fileError}</InlineNotice> : null}
        {previewMutation.isError ? (
          <InlineNotice tone="danger">{previewMutation.error.message}</InlineNotice>
        ) : null}
        <Field label={t("settings.strategy")}>
          <span className="select-wrap">
            <select
              value={strategy}
              onChange={(event) => changeStrategy(event.target.value as typeof strategy)}
            >
              <option value="skip">{t("settings.skip")}</option>
              <option value="overwrite">{t("settings.overwrite")}</option>
              <option value="duplicate">{t("settings.duplicate")}</option>
            </select>
            <IconChevronDown size={17} />
          </span>
        </Field>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={importProfile}
            onChange={(event) => changeImportProfile(event.target.checked)}
          />
          <span>
            <strong>{t("settings.importProfile")}</strong>
          </span>
        </label>
        <Button
          disabled={!archive || previewMutation.isPending}
          onClick={() =>
            archive &&
            previewMutation.mutate({
              archive,
              conflictStrategy: strategy,
              importProfile,
            })
          }
        >
          {previewMutation.isPending ? t("settings.previewing") : t("settings.previewImport")}
        </Button>

        {preview ? (
          <div className="import-preview">
            <h3>{t("settings.importSummary")}</h3>
            <div className="import-preview__counts">
              <div>
                <span>{t("settings.resources")}</span>
                <strong>
                  {preview.counts.categories +
                    preview.counts.paymentMethods +
                    preview.counts.subscriptions}
                </strong>
              </div>
              <div>
                <span>{t("settings.conflicts")}</span>
                <strong>
                  {preview.conflicts.categories +
                    preview.conflicts.paymentMethods +
                    preview.conflicts.subscriptions}
                </strong>
              </div>
              <div>
                <span>{t("settings.warnings")}</span>
                <strong>{preview.warnings.length}</strong>
              </div>
            </div>
            {preview.warnings.length ? (
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={`${warning.path}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            ) : null}
            <ReminderImportImpact impact={preview.reminderImpact} />
            {importMutation.isError ? (
              <InlineNotice tone="danger">{importMutation.error.message}</InlineNotice>
            ) : null}
            {importMutation.isSuccess ? <ImportResultSummary result={importMutation.data} /> : null}
            <Button disabled={importMutation.isPending} onClick={() => importMutation.mutate()}>
              {importMutation.isPending ? t("settings.importing") : t("settings.confirmImport")}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function importResourceCount(
  counts: ImportResult["created"] | ImportResult["updated"] | ImportResult["skipped"],
): number {
  return counts.categories + counts.paymentMethods + counts.subscriptions;
}

function ReminderImportImpact({ impact }: { impact: ImportResult["reminderImpact"] }) {
  const { t } = useTranslation();
  return (
    <section className="import-reminder-impact">
      <h4>{t("settings.reminderImportImpact")}</h4>
      <dl>
        <div>
          <dt>{t("settings.enabledReminderPreferences")}</dt>
          <dd>{impact.enabledPreferencesAfterApply}</dd>
        </div>
        <div>
          <dt>{t("settings.emailSender")}</dt>
          <dd>
            {impact.senderCapabilityAvailable
              ? t("settings.emailSenderAvailable")
              : t("settings.emailSenderUnavailable")}
          </dd>
        </div>
      </dl>
      {impact.willForceGlobalPause ? (
        <InlineNotice tone="warning">{t("settings.importWillPauseReminders")}</InlineNotice>
      ) : null}
    </section>
  );
}

export function ImportResultSummary({ result }: { result: ImportResult }) {
  const { t } = useTranslation();
  const counts = [
    { label: t("settings.created"), value: importResourceCount(result.created) },
    { label: t("settings.updated"), value: importResourceCount(result.updated) },
    { label: t("settings.skipped"), value: importResourceCount(result.skipped) },
    { label: t("settings.warnings"), value: result.warnings.length },
  ];

  return (
    <section className="import-result" role="status" aria-live="polite">
      <InlineNotice tone="success">
        <strong>{t("settings.importComplete")}</strong>
      </InlineNotice>
      <div className="import-result__counts">
        {counts.map((count) => (
          <div key={count.label}>
            <span>{count.label}</span>
            <strong>{count.value}</strong>
          </div>
        ))}
      </div>
      <ReminderImportImpact impact={result.reminderImpact} />
      {result.warnings.length ? (
        <ul>
          {result.warnings.map((warning, index) => (
            <li key={`${warning.path}-${warning.code}-${index}`}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

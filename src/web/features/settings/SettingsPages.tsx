import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCategory,
  IconChevronDown,
  IconCreditCard,
  IconDatabaseExport,
  IconDatabaseImport,
  IconLanguage,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconUserCircle,
} from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api/client";
import type {
  Category as CategoryType,
  CommonIconKey,
  ImportResult,
  PaymentMethodKind,
  ResourceSymbol,
  Session,
} from "../../api/types";
import { CategorySymbol, PaymentMethodSymbol } from "../../components/ResourceSymbol";
import {
  SymbolPicker,
  type EmojiOption,
  type SymbolPickerLabels,
} from "../../components/SymbolPicker";
import {
  Button,
  CategoryPill,
  Dialog,
  Field,
  InlineNotice,
  LoadingPage,
  QueryError,
} from "../../components/ui";
import { COMMON_ICON_KEYS } from "../../../domain/symbol";
import { normalizeCategoryNameKey } from "../../../domain/text-normalization";
import {
  CATEGORY_PRESETS,
  PAYMENT_METHOD_PRESETS,
  type CategoryPresetKey,
  type PaymentMethodPreset,
} from "../../../shared/presets";
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

function useSymbolPickerCopy(): {
  emojiOptions: readonly EmojiOption[];
  iconLabels: Readonly<Record<CommonIconKey, string>>;
  labels: SymbolPickerLabels;
} {
  const { t } = useTranslation();
  const iconLabels = Object.fromEntries(
    COMMON_ICON_KEYS.map((key) => [key, t(`symbols.icons.${key}`)]),
  ) as Record<CommonIconKey, string>;
  return {
    iconLabels,
    emojiOptions: [
      { value: "⭐", label: t("symbols.emojis.star") },
      { value: "🎬", label: t("symbols.emojis.movie") },
      { value: "🎵", label: t("symbols.emojis.music") },
      { value: "☁️", label: t("symbols.emojis.cloud") },
      { value: "💳", label: t("symbols.emojis.card") },
      { value: "🧾", label: t("symbols.emojis.receipt") },
      { value: "✈️", label: t("symbols.emojis.travel") },
      { value: "🛠️", label: t("symbols.emojis.tools") },
    ],
    labels: {
      legend: t("symbols.legend"),
      commonIcons: t("symbols.commonIcons"),
      emoji: t("symbols.emoji"),
      emojiInput: t("symbols.emojiInput"),
      emojiInputPlaceholder: t("symbols.emojiInputPlaceholder"),
      invalidEmoji: t("symbols.invalidEmoji"),
      clear: t("symbols.clear"),
    },
  };
}

export function SettingsLayout() {
  const { t } = useTranslation();
  return (
    <div className="page page--settings">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{t("app.name")}</p>
          <h1>{t("settings.title")}</h1>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("settings.title")}>
          {settingsNav.map(({ to, key, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "is-active" : "")}>
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
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["me"], queryFn: api.me });
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: api.session });
  const mutation = useMutation({
    mutationFn: api.updateMe,
    onSuccess: async (user) => {
      queryClient.setQueryData(["me"], user);
      queryClient.setQueryData<Session | undefined>(["session"], (current) =>
        current ? { ...current, user } : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (query.isPending || sessionQuery.isPending) return <LoadingPage variant="form" />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  if (sessionQuery.isError) {
    return <QueryError error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />;
  }

  const user = query.data;
  const isLocalEnvironment = sessionQuery.data.environment === "local";
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
      {mutation.isSuccess ? <InlineNotice tone="success">{t("app.save")}</InlineNotice> : null}
      <form className="settings-form" onSubmit={submit}>
        <Field label={t("settings.email")}>
          <input value={user.email} readOnly disabled />
        </Field>
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
        <div className="settings-form__actions">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t("app.saving") : t("app.save")}
          </Button>
        </div>
      </form>

      <div className="settings-language">
        <div>
          <IconLanguage size={21} />
          <div>
            <h3>{t("settings.languageAndAppearance")}</h3>
            <p>{t("app.language")}</p>
          </div>
        </div>
        <label className="select-wrap">
          <span className="sr-only">{t("app.language")}</span>
          <select
            value={i18n.language.startsWith("zh") ? "zh-Hans" : "en"}
            onChange={(event) => void setLanguage(event.target.value as "en" | "zh-Hans")}
          >
            <option value="en">{t("app.english")}</option>
            <option value="zh-Hans">{t("app.chinese")}</option>
          </select>
          <IconChevronDown size={17} />
        </label>
      </div>

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

export function CategorySettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const symbolPicker = useSymbolPickerCopy();
  const [editing, setEditing] = useState<CategoryType | null>(null);
  const [deleting, setDeleting] = useState<CategoryType | null>(null);
  const [symbol, setSymbol] = useState<ResourceSymbol>(null);
  const [formRevision, setFormRevision] = useState(0);
  const [selectedPresetKeys, setSelectedPresetKeys] = useState<ReadonlySet<CategoryPresetKey>>(
    () => new Set(),
  );
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
      setEditing(null);
      setSymbol(null);
      setFormRevision((value) => value + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const presetMutation = useMutation({
    mutationFn: (presetKeys: readonly CategoryPresetKey[]) => {
      const existingNames = new Set(
        (query.data ?? []).map((category) => normalizeCategoryNameKey(category.name)),
      );
      const categories = CATEGORY_PRESETS.filter((preset) => presetKeys.includes(preset.key))
        .map((preset) => ({
          name: t(preset.labelKey),
          color: preset.color,
          symbol: preset.symbol,
        }))
        .filter((preset) => !existingNames.has(normalizeCategoryNameKey(preset.name)))
        .map((preset, index) => ({
          ...preset,
          position: (query.data?.length ?? 0) + index,
        }));
      return api.createCategoriesBatch(categories);
    },
    onSuccess: async () => {
      setSelectedPresetKeys(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: async () => {
      setDeleting(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
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
  const selectedPresets = CATEGORY_PRESETS.filter(
    (preset) =>
      selectedPresetKeys.has(preset.key) &&
      !existingNames.has(normalizeCategoryNameKey(t(preset.labelKey))),
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutation.mutate({
      id: editing?.id,
      name: formString(values, "name"),
      color: formString(values, "color", "#3b82f6"),
      symbol,
      position: editing?.position ?? categories.length,
    });
  }

  function togglePreset(key: CategoryPresetKey) {
    setSelectedPresetKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function startEditing(category: CategoryType) {
    setEditing(category);
    setSymbol(category.symbol);
  }

  function cancelEditing() {
    setEditing(null);
    setSymbol(null);
    setFormRevision((value) => value + 1);
  }

  return (
    <section className="surface settings-panel">
      <header className="settings-panel__header">
        <div>
          <h2>{t("settings.categories")}</h2>
          <p>{t("settings.categoriesIntro")}</p>
        </div>
      </header>
      {mutation.isError || presetMutation.isError || deleteMutation.isError ? (
        <InlineNotice tone="danger">
          {(mutation.error ?? presetMutation.error ?? deleteMutation.error)?.message}
        </InlineNotice>
      ) : null}

      <section className="settings-form" aria-labelledby="category-presets-title">
        <header className="settings-panel__header">
          <div>
            <h3 id="category-presets-title">{t("settings.categoryPresets")}</h3>
            <p>{t("settings.categoryPresetsIntro")}</p>
          </div>
          <IconSparkles size={21} aria-hidden="true" />
        </header>
        <div className="resource-list">
          {CATEGORY_PRESETS.map((preset) => {
            const name = t(preset.labelKey);
            const exists = existingNames.has(normalizeCategoryNameKey(name));
            return (
              <label className="resource-row checkbox-field" key={preset.key}>
                <input
                  type="checkbox"
                  checked={selectedPresetKeys.has(preset.key) && !exists}
                  disabled={exists || presetMutation.isPending}
                  onChange={() => togglePreset(preset.key)}
                />
                <CategorySymbol symbol={preset.symbol} color={preset.color} size={22} />
                <span>
                  <strong>{name}</strong>
                  <small>
                    {exists ? t("settings.presetAlreadyAdded") : t("settings.presetReady")}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
        <div className="settings-form__actions">
          <Button
            type="button"
            variant="secondary"
            disabled={selectedPresets.length === 0 || presetMutation.isPending}
            onClick={() => presetMutation.mutate(selectedPresets.map((preset) => preset.key))}
          >
            <IconPlus size={18} />
            {presetMutation.isPending
              ? t("app.saving")
              : t("settings.addSelectedPresets", { count: selectedPresets.length })}
          </Button>
        </div>
      </section>

      <form className="resource-form" onSubmit={submit} key={editing?.id ?? `new-${formRevision}`}>
        <Field label={t("settings.categoryName")}>
          <input name="name" maxLength={80} defaultValue={editing?.name ?? ""} required />
        </Field>
        <Field label={t("settings.color")}>
          <input name="color" type="color" defaultValue={editing?.color ?? "#3b82f6"} />
        </Field>
        <SymbolPicker value={symbol} onChange={setSymbol} {...symbolPicker} />
        <Button type="submit" disabled={mutation.isPending}>
          {editing ? (
            t("app.save")
          ) : (
            <>
              <IconPlus size={18} />
              {t("settings.addCategory")}
            </>
          )}
        </Button>
        {editing ? (
          <Button variant="ghost" onClick={cancelEditing}>
            {t("app.cancel")}
          </Button>
        ) : null}
      </form>
      <div className="resource-list">
        {categories.length ? (
          categories.map((category) => (
            <div className="resource-row" key={category.id}>
              <CategoryPill name={category.name} color={category.color} symbol={category.symbol} />
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
  const query = useQuery({ queryKey: ["payment-methods"], queryFn: api.paymentMethods });
  const symbolPicker = useSymbolPickerCopy();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [symbol, setSymbol] = useState<ResourceSymbol>(null);
  const [formRevision, setFormRevision] = useState(0);
  const [presetDraft, setPresetDraft] = useState<{
    preset: PaymentMethodPreset;
    name: string;
    revision: number;
  } | null>(null);
  const editing = query.data?.find((payment) => payment.id === editingId) ?? null;
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
      setEditingId(null);
      setPresetDraft(null);
      setSymbol(null);
      setFormRevision((value) => value + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-methods"] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: api.deletePaymentMethod,
    onSuccess: async () => {
      setDeletingId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-methods"] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
      ]);
    },
  });

  if (query.isPending) return <LoadingPage variant="form" />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const paymentMethods = query.data;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutation.mutate({
      id: editing?.id,
      name: formString(values, "name"),
      kind: formString(values, "kind", "card") as PaymentMethodKind,
      label: formString(values, "label").trim() || null,
      symbol,
      position: editing?.position ?? paymentMethods.length,
    });
  }

  function selectPreset(preset: PaymentMethodPreset) {
    setEditingId(null);
    setSymbol(preset.symbol);
    setPresetDraft({ preset, name: t(preset.labelKey), revision: formRevision + 1 });
    setFormRevision((value) => value + 1);
  }

  function startEditing(id: string) {
    const paymentMethod = paymentMethods.find((payment) => payment.id === id);
    if (!paymentMethod) return;
    setPresetDraft(null);
    setEditingId(id);
    setSymbol(paymentMethod.symbol);
  }

  function cancelEditing() {
    setEditingId(null);
    setPresetDraft(null);
    setSymbol(null);
    setFormRevision((value) => value + 1);
  }

  return (
    <section className="surface settings-panel">
      <header className="settings-panel__header">
        <div>
          <h2>{t("settings.paymentMethods")}</h2>
          <p>{t("settings.paymentIntro")}</p>
        </div>
      </header>
      {mutation.isError || deleteMutation.isError ? (
        <InlineNotice tone="danger">
          {(mutation.error ?? deleteMutation.error)?.message}
        </InlineNotice>
      ) : null}

      <section className="settings-form" aria-labelledby="payment-presets-title">
        <header className="settings-panel__header">
          <div>
            <h3 id="payment-presets-title">{t("settings.paymentPresets")}</h3>
            <p>{t("settings.paymentPresetsIntro")}</p>
          </div>
          <IconSparkles size={21} aria-hidden="true" />
        </header>
        <div className="resource-list">
          {PAYMENT_METHOD_PRESETS.map((preset) => (
            <div className="resource-row" key={preset.key}>
              <span className="payment-display">
                <PaymentMethodSymbol symbol={preset.symbol} kind={preset.kind} size={22} />
                <span>
                  <strong>{t(preset.labelKey)}</strong>
                  <small>{t(`settings.kinds.${preset.kind}`)}</small>
                </span>
              </span>
              <Button type="button" variant="ghost" onClick={() => selectPreset(preset)}>
                {t("settings.usePreset")}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {presetDraft ? <InlineNotice>{t("settings.paymentPresetReady")}</InlineNotice> : null}
      <form
        className="resource-form resource-form--payment"
        onSubmit={submit}
        key={editing?.id ?? presetDraft?.revision ?? `new-${formRevision}`}
      >
        <Field label={t("settings.paymentName")}>
          <input
            name="name"
            maxLength={80}
            defaultValue={editing?.name ?? presetDraft?.name ?? ""}
            required
          />
        </Field>
        <Field label={t("settings.paymentKind")}>
          <span className="select-wrap">
            <select name="kind" defaultValue={editing?.kind ?? presetDraft?.preset.kind ?? "card"}>
              {(["card", "wallet", "bank", "store", "other"] as const).map((kind) => (
                <option value={kind} key={kind}>
                  {t(`settings.kinds.${kind}`)}
                </option>
              ))}
            </select>
            <IconChevronDown size={17} />
          </span>
        </Field>
        <Field label={t("settings.paymentLabel")}>
          <input
            name="label"
            maxLength={80}
            defaultValue={editing?.label ?? ""}
            placeholder={t("settings.paymentLabelPlaceholder")}
          />
        </Field>
        <SymbolPicker value={symbol} onChange={setSymbol} {...symbolPicker} />
        <Button type="submit" disabled={mutation.isPending}>
          {editing || presetDraft ? (
            t("app.save")
          ) : (
            <>
              <IconPlus size={18} />
              {t("settings.addPaymentMethod")}
            </>
          )}
        </Button>
        {editing || presetDraft ? (
          <Button variant="ghost" onClick={cancelEditing}>
            {t("app.cancel")}
          </Button>
        ) : null}
      </form>
      <div className="resource-list">
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
      setArchive(null);
      setFileName("");
      setFileError(t("settings.invalidArchive"));
    }
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
        <Button
          disabled={!archive || previewMutation.isPending}
          onClick={() => archive && previewMutation.mutate(archive)}
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
            <Field label={t("settings.strategy")}>
              <span className="select-wrap">
                <select
                  value={strategy}
                  onChange={(event) => setStrategy(event.target.value as typeof strategy)}
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
                onChange={(event) => setImportProfile(event.target.checked)}
              />
              <span>
                <strong>{t("settings.importProfile")}</strong>
              </span>
            </label>
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

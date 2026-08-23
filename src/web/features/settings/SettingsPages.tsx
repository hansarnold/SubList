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
  IconTrash,
  IconUserCircle,
} from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api/client";
import type { Category as CategoryType, PaymentMethodKind } from "../../api/types";
import {
  Button,
  CategoryPill,
  Dialog,
  Field,
  InlineNotice,
  LoadingPage,
  QueryError,
} from "../../components/ui";
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
      defaultCurrency: formString(values, "defaultCurrency", user.defaultCurrency).toUpperCase(),
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
          <Field label={t("settings.defaultCurrency")}>
            <input
              name="defaultCurrency"
              maxLength={3}
              defaultValue={user.defaultCurrency}
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
  const [editing, setEditing] = useState<CategoryType | null>(null);
  const [deleting, setDeleting] = useState<CategoryType | null>(null);
  const mutation = useMutation({
    mutationFn: ({
      id,
      name,
      color,
      position,
    }: {
      id: string | undefined;
      name: string;
      color: string;
      position: number;
    }) =>
      id
        ? api.updateCategory(id, { name, color, position })
        : api.createCategory({ name, color, position }),
    onSuccess: async () => {
      setEditing(null);
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutation.mutate({
      id: editing?.id,
      name: formString(values, "name"),
      color: formString(values, "color", "#3b82f6"),
      position: editing?.position ?? categories.length,
    });
    if (!editing) event.currentTarget.reset();
  }

  return (
    <section className="surface settings-panel">
      <header className="settings-panel__header">
        <div>
          <h2>{t("settings.categories")}</h2>
          <p>{t("settings.categoriesIntro")}</p>
        </div>
      </header>
      {mutation.isError || deleteMutation.isError ? (
        <InlineNotice tone="danger">
          {(mutation.error ?? deleteMutation.error)?.message}
        </InlineNotice>
      ) : null}
      <form className="resource-form" onSubmit={submit} key={editing?.id ?? "new"}>
        <Field label={t("settings.categoryName")}>
          <input name="name" maxLength={80} defaultValue={editing?.name ?? ""} required />
        </Field>
        <Field label={t("settings.color")}>
          <input name="color" type="color" defaultValue={editing?.color ?? "#3b82f6"} />
        </Field>
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
          <Button variant="ghost" onClick={() => setEditing(null)}>
            {t("app.cancel")}
          </Button>
        ) : null}
      </form>
      <div className="resource-list">
        {categories.length ? (
          categories.map((category) => (
            <div className="resource-row" key={category.id}>
              <CategoryPill name={category.name} color={category.color} />
              <div className="resource-row__actions">
                <Button variant="ghost" onClick={() => setEditing(category)}>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const editing = query.data?.find((payment) => payment.id === editingId) ?? null;
  const deleting = query.data?.find((payment) => payment.id === deletingId) ?? null;
  const mutation = useMutation({
    mutationFn: (input: {
      id: string | undefined;
      name: string;
      kind: PaymentMethodKind;
      label: string | null;
      position: number;
    }) =>
      input.id
        ? api.updatePaymentMethod(input.id, {
            name: input.name,
            kind: input.kind,
            label: input.label,
            position: input.position,
          })
        : api.createPaymentMethod({
            name: input.name,
            kind: input.kind,
            label: input.label,
            position: input.position,
          }),
    onSuccess: async () => {
      setEditingId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-methods"] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
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
      position: editing?.position ?? paymentMethods.length,
    });
    if (!editing) event.currentTarget.reset();
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
      <form
        className="resource-form resource-form--payment"
        onSubmit={submit}
        key={editing?.id ?? "new"}
      >
        <Field label={t("settings.paymentName")}>
          <input name="name" maxLength={80} defaultValue={editing?.name ?? ""} required />
        </Field>
        <Field label={t("settings.paymentKind")}>
          <span className="select-wrap">
            <select name="kind" defaultValue={editing?.kind ?? "card"}>
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
        <Button type="submit" disabled={mutation.isPending}>
          {editing ? (
            t("app.save")
          ) : (
            <>
              <IconPlus size={18} />
              {t("settings.addPaymentMethod")}
            </>
          )}
        </Button>
        {editing ? (
          <Button variant="ghost" onClick={() => setEditingId(null)}>
            {t("app.cancel")}
          </Button>
        ) : null}
      </form>
      <div className="resource-list">
        {paymentMethods.length ? (
          paymentMethods.map((payment) => (
            <div className="resource-row" key={payment.id}>
              <span className="payment-display">
                <IconCreditCard size={20} />
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
                <Button variant="ghost" onClick={() => setEditingId(payment.id)}>
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
            {importMutation.isSuccess ? (
              <InlineNotice tone="success">{t("settings.importComplete")}</InlineNotice>
            ) : null}
            <Button disabled={importMutation.isPending} onClick={() => importMutation.mutate()}>
              {importMutation.isPending ? t("settings.importing") : t("settings.confirmImport")}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

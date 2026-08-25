import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { normalizeCategoryNameKey } from "../../domain/text-normalization";
import type { ResourceSymbol } from "../../domain/symbol";
import {
  CATEGORY_PRESETS,
  PAYMENT_METHOD_PRESETS,
  type CategoryPreset,
  type PaymentMethodPreset,
} from "../../shared/presets";
import { ApiError, api } from "../api/client";
import { categoriesQueryKey, paymentMethodsQueryKey } from "../api/query-keys";
import type {
  Category,
  CategoryInput,
  PaymentMethod,
  PaymentMethodInput,
  PaymentMethodKind,
} from "../api/types";
import { CategorySymbol, PaymentMethodSymbol } from "./ResourceSymbol";
import { CategoryEditorFields, PaymentMethodEditorFields } from "./ResourceEditorFields";
import { Button, InlineNotice } from "./ui";

type AssociationKind = "category" | "payment-method";
type AssociationResource = Category | PaymentMethod;

type PresetOption =
  | {
      kind: "category";
      key: CategoryPreset["key"];
      name: string;
      color: string;
      symbol: ResourceSymbol;
    }
  | {
      kind: "payment-method";
      key: PaymentMethodPreset["key"];
      name: string;
      paymentKind: PaymentMethodKind;
      symbol: ResourceSymbol;
    };

type AssociationDraft =
  | {
      kind: "category";
      mode: "preset" | "custom";
      revision: number;
      name: string;
      color: string;
      symbol: ResourceSymbol;
    }
  | {
      kind: "payment-method";
      mode: "preset" | "custom";
      revision: number;
      name: string;
      paymentKind: PaymentMethodKind;
      symbol: ResourceSymbol;
    };

type CreateRequest = (
  { kind: "category"; input: CategoryInput } | { kind: "payment-method"; input: PaymentMethodInput }
) & { userId: string };

type ResourceAssociationFieldProps = {
  id: string;
  kind: AssociationKind;
  userId: string;
  value: string;
  resources: readonly AssociationResource[];
  loading: boolean;
  error: unknown;
  validationError?: string | undefined;
  disabled?: boolean;
  onChange: (id: string) => void;
  onRetry: () => void;
  onPendingChange: (pending: boolean) => void;
};

function associationQueryKey(request: CreateRequest) {
  return request.kind === "category"
    ? categoriesQueryKey(request.userId)
    : paymentMethodsQueryKey(request.userId);
}

function formString(values: FormData, name: string, fallback = "") {
  const value = values.get(name);
  return typeof value === "string" ? value : fallback;
}

function nextPosition(resources: readonly AssociationResource[]) {
  return resources.reduce((maximum, resource) => Math.max(maximum, resource.position), -1) + 1;
}

function insertResource<T extends AssociationResource>(current: T[] | undefined, resource: T): T[] {
  const withoutDuplicate = (current ?? []).filter((item) => item.id !== resource.id);
  return [...withoutDuplicate, resource].sort(
    (left, right) => left.position - right.position || left.name.localeCompare(right.name),
  );
}

function resourceSymbol(kind: AssociationKind, resource: AssociationResource, size = 21) {
  return kind === "category" ? (
    <CategorySymbol symbol={resource.symbol} color={(resource as Category).color} size={size} />
  ) : (
    <PaymentMethodSymbol
      symbol={resource.symbol}
      kind={(resource as PaymentMethod).kind}
      size={size}
    />
  );
}

function presetSymbol(preset: PresetOption, size = 21) {
  return preset.kind === "category" ? (
    <CategorySymbol symbol={preset.symbol} color={preset.color} size={size} />
  ) : (
    <PaymentMethodSymbol symbol={preset.symbol} kind={preset.paymentKind} size={size} />
  );
}

function ResourceEditorDialog({
  draft,
  busy,
  error,
  onSymbolChange,
  onSubmit,
  onClose,
}: {
  draft: AssociationDraft;
  busy: boolean;
  error: unknown;
  onSymbolChange: (symbol: ResourceSymbol) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
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
    };
  }, []);

  function handleBackdropPointer(event: MouseEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside && !busy) onClose();
  }

  const title =
    draft.kind === "category" ? t("form.createCategory") : t("form.createPaymentMethod");

  return createPortal(
    <dialog
      ref={dialogRef}
      className="dialog resource-editor-dialog"
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
      <p>{t("form.resourceCreateExplanation")}</p>
      {error ? (
        <InlineNotice tone="danger">
          {error instanceof ApiError || error instanceof Error
            ? error.message
            : t("app.unknownError")}
        </InlineNotice>
      ) : null}
      <form className="resource-editor-dialog__form" onSubmit={onSubmit}>
        {draft.kind === "category" ? (
          <CategoryEditorFields
            defaultName={draft.name}
            defaultColor={draft.color}
            symbol={draft.symbol}
            onSymbolChange={onSymbolChange}
            disabled={busy}
            autoFocus
          />
        ) : (
          <PaymentMethodEditorFields
            defaultName={draft.name}
            defaultKind={draft.paymentKind}
            symbol={draft.symbol}
            onSymbolChange={onSymbolChange}
            disabled={busy}
            autoFocus
          />
        )}
        <div className="dialog__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t("app.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("app.saving") : t("form.addAndSelect")}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

export function ResourceAssociationField({
  id,
  kind,
  userId,
  value,
  resources,
  loading,
  error,
  validationError,
  disabled = false,
  onChange,
  onRetry,
  onPendingChange,
}: ResourceAssociationFieldProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<AssociationDraft | null>(null);
  const revisionRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = `${id}-options`;
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const validationErrorId = validationError ? `${id}-error` : undefined;
  const selected = resources.find((resource) => resource.id === value);
  const resourceLabel = kind === "category" ? t("form.category") : t("form.paymentMethod");
  const presets = useMemo<PresetOption[]>(
    () =>
      kind === "category"
        ? CATEGORY_PRESETS.map((preset) => ({
            kind: "category" as const,
            key: preset.key,
            name: t(preset.labelKey),
            color: preset.color,
            symbol: preset.symbol,
          }))
        : PAYMENT_METHOD_PRESETS.map((preset) => ({
            kind: "payment-method" as const,
            key: preset.key,
            name: t(preset.labelKey),
            paymentKind: preset.kind,
            symbol: preset.symbol,
          })),
    [kind, t],
  );

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredResources = normalizedSearch
    ? resources.filter((resource) => resource.name.toLocaleLowerCase().includes(normalizedSearch))
    : resources;
  const availablePresets = presets.filter(
    (preset) =>
      !resources.some(
        (resource) =>
          normalizeCategoryNameKey(resource.name) === normalizeCategoryNameKey(preset.name),
      ),
  );
  const filteredPresets = normalizedSearch
    ? availablePresets.filter((preset) =>
        preset.name.toLocaleLowerCase().includes(normalizedSearch),
      )
    : availablePresets;
  const showSearch = resources.length + availablePresets.length > 10;

  const createMutation = useMutation({
    mutationFn: (request: CreateRequest): Promise<AssociationResource> =>
      request.kind === "category"
        ? api.createCategory(request.input)
        : api.createPaymentMethod(request.input),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: associationQueryKey(request) });
    },
    onSuccess: (created, request) => {
      if (request.kind === "category") {
        const category = created as Category;
        queryClient.setQueryData<Category[]>(categoriesQueryKey(request.userId), (current) =>
          insertResource(current, category),
        );
      } else {
        const paymentMethod = created as PaymentMethod;
        queryClient.setQueryData<PaymentMethod[]>(
          paymentMethodsQueryKey(request.userId),
          (current) => insertResource(current, paymentMethod),
        );
      }
      void queryClient.invalidateQueries({ queryKey: associationQueryKey(request) });
      if (request.userId !== userId) return;
      onChange(created.id);
      setDraft(null);
      setOpen(false);
      setSearch("");
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    },
  });

  useEffect(() => {
    onPendingChange(createMutation.isPending);
  }, [createMutation.isPending, onPendingChange]);

  useEffect(
    () => () => {
      onPendingChange(false);
    },
    [onPendingChange],
  );

  useEffect(() => {
    if (!open) return;
    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      setOpen(false);
      setSearch("");
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  function closeMenu() {
    setOpen(false);
    setSearch("");
  }

  function selectResource(id: string) {
    onChange(id);
    closeMenu();
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openPreset(preset: PresetOption) {
    if (preset.kind === "category") {
      const existing = resources.find(
        (resource) =>
          normalizeCategoryNameKey(resource.name) === normalizeCategoryNameKey(preset.name),
      );
      if (existing) {
        selectResource(existing.id);
        return;
      }
      revisionRef.current += 1;
      setDraft({
        kind: "category",
        mode: "preset",
        revision: revisionRef.current,
        name: preset.name,
        color: preset.color,
        symbol: preset.symbol,
      });
    } else {
      revisionRef.current += 1;
      setDraft({
        kind: "payment-method",
        mode: "preset",
        revision: revisionRef.current,
        name: preset.name,
        paymentKind: preset.paymentKind,
        symbol: preset.symbol,
      });
    }
    createMutation.reset();
    closeMenu();
  }

  function openCustomDraft() {
    revisionRef.current += 1;
    setDraft(
      kind === "category"
        ? {
            kind: "category",
            mode: "custom",
            revision: revisionRef.current,
            name: "",
            color: "#4F7CFF",
            symbol: null,
          }
        : {
            kind: "payment-method",
            mode: "custom",
            revision: revisionRef.current,
            name: "",
            paymentKind: "card",
            symbol: null,
          },
    );
    createMutation.reset();
    closeMenu();
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!draft) return;
    const values = new FormData(event.currentTarget);
    if (draft.kind === "category") {
      createMutation.mutate({
        kind: "category",
        userId,
        input: {
          name: formString(values, "name"),
          color: formString(values, "color", draft.color),
          symbol: draft.symbol,
          position: nextPosition(resources),
        },
      });
    } else {
      createMutation.mutate({
        kind: "payment-method",
        userId,
        input: {
          name: formString(values, "name"),
          kind: formString(values, "kind", draft.paymentKind) as PaymentMethodKind,
          label: formString(values, "label").trim() || null,
          symbol: draft.symbol,
          position: nextPosition(resources),
        },
      });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
    }
  }

  const triggerContent: ReactNode = selected ? (
    <>
      {resourceSymbol(kind, selected)}
      <span>{selected.name}</span>
    </>
  ) : value ? (
    <span>{t("form.currentAssociationUnavailable")}</span>
  ) : (
    <span>{kind === "category" ? t("form.chooseCategory") : t("form.choosePaymentMethod")}</span>
  );

  const savedOptions = (
    <section className="resource-association__section">
      <h3>{kind === "category" ? t("form.savedCategories") : t("form.savedPaymentMethods")}</h3>
      <button
        type="button"
        className={!value ? "is-selected" : undefined}
        aria-pressed={!value}
        onClick={() => selectResource("")}
      >
        <span className="resource-association__empty-symbol" aria-hidden="true">
          —
        </span>
        <span>{kind === "category" ? t("form.noCategory") : t("form.noPaymentMethod")}</span>
      </button>
      {filteredResources.map((resource) => (
        <button
          type="button"
          className={resource.id === value ? "is-selected" : undefined}
          aria-pressed={resource.id === value}
          key={resource.id}
          onClick={() => selectResource(resource.id)}
        >
          {resourceSymbol(kind, resource)}
          <span>{resource.name}</span>
        </button>
      ))}
      {normalizedSearch && filteredResources.length === 0 ? (
        <p>{t("form.noResourceMatches")}</p>
      ) : null}
    </section>
  );

  const commonOptions = availablePresets.length ? (
    <section className="resource-association__section">
      <h3>
        <IconSparkles size={16} aria-hidden="true" />
        {kind === "category" ? t("form.commonCategories") : t("form.commonPaymentMethods")}
      </h3>
      {filteredPresets.map((preset) => (
        <button type="button" key={preset.key} onClick={() => openPreset(preset)}>
          {presetSymbol(preset)}
          <span>{preset.name}</span>
        </button>
      ))}
      {normalizedSearch && filteredPresets.length === 0 ? <p>{t("form.noCommonMatches")}</p> : null}
    </section>
  ) : null;

  return (
    <div ref={rootRef} className="resource-association" onKeyDown={handleKeyDown}>
      <span className="field__label" id={labelId}>
        {resourceLabel}
      </span>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="resource-association__trigger"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={validationErrorId}
        aria-invalid={validationError ? true : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled || loading || Boolean(error)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="resource-association__selection" id={valueId}>
          {triggerContent}
        </span>
        <IconChevronDown size={18} aria-hidden="true" />
      </button>

      {loading ? (
        <p className="resource-association__status" role="status">
          {t("form.loadingResources", { resource: resourceLabel })}
        </p>
      ) : null}
      {error ? (
        <InlineNotice tone="danger">
          <span>{t("form.resourceLoadError", { resource: resourceLabel })}</span>
          <Button type="button" variant="ghost" onClick={onRetry}>
            <IconRefresh size={17} aria-hidden="true" />
            {t("app.retry")}
          </Button>
        </InlineNotice>
      ) : null}

      {open && !loading && !error ? (
        <div
          id={panelId}
          className="resource-association__panel"
          role="group"
          aria-label={resourceLabel}
        >
          {showSearch ? (
            <label className="resource-association__search">
              <IconSearch size={17} aria-hidden="true" />
              <span className="visually-hidden">
                {t("form.searchResources", { resource: resourceLabel })}
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                placeholder={t("form.searchResources", { resource: resourceLabel })}
                autoFocus
              />
            </label>
          ) : null}

          {resources.length === 0 ? commonOptions : savedOptions}
          {resources.length === 0 ? savedOptions : commonOptions}

          <div className="resource-association__actions">
            <Button type="button" variant="ghost" onClick={openCustomDraft}>
              <IconPlus size={18} aria-hidden="true" />
              {kind === "category" ? t("form.createCategory") : t("form.createPaymentMethod")}
            </Button>
          </div>
        </div>
      ) : null}

      {validationError ? (
        <span className="field__error" id={validationErrorId}>
          {validationError}
        </span>
      ) : null}

      {draft ? (
        <ResourceEditorDialog
          key={draft.revision}
          draft={draft}
          busy={createMutation.isPending}
          error={createMutation.error}
          onSymbolChange={(symbol) =>
            setDraft((current) => (current ? { ...current, symbol } : null))
          }
          onSubmit={submitDraft}
          onClose={() => {
            if (createMutation.isPending) return;
            setDraft(null);
            createMutation.reset();
            window.requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

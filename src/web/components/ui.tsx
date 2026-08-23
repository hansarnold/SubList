import {
  Children,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEvent,
  type PropsWithChildren,
  type ReactNode,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
} from "react";
import { IconAlertCircle, IconRefresh, IconX } from "@tabler/icons-react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { serviceMonogram } from "../utils/format";

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button type={type} className={clsx("button", `button--${variant}`, className)} {...props} />
  );
}

export function IconButton({
  label,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      className={clsx("icon-button", className)}
      aria-label={label}
      title={label}
      {...props}
    />
  );
}

export function ServiceMark({ name, color }: { name: string; color?: string | null | undefined }) {
  return (
    <span
      className="service-mark"
      aria-hidden="true"
      style={color ? ({ "--service-color": color } as CSSProperties) : undefined}
    >
      {serviceMonogram(name)}
    </span>
  );
}

export function CategoryPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="category-pill" style={{ "--category-color": color } as React.CSSProperties}>
      <span className="category-pill__dot" aria-hidden="true" />
      {name}
    </span>
  );
}

export function StatusBadge({
  status,
  archived,
}: {
  status: "active" | "cancelled";
  archived?: boolean;
}) {
  const { t } = useTranslation();
  const label = archived
    ? t("detail.archived")
    : status === "active"
      ? t("subscriptions.active")
      : t("subscriptions.cancelled");
  return (
    <span className={clsx("status-badge", `status-badge--${archived ? "archived" : status}`)}>
      {label}
    </span>
  );
}

export function PageMessage({
  title,
  body,
  icon,
  actions,
}: {
  title: string;
  body: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="page-message">
      <div className="page-message__icon" aria-hidden="true">
        {icon ?? <IconAlertCircle size={24} />}
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {actions ? <div className="page-message__actions">{actions}</div> : null}
    </section>
  );
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const apiError = error instanceof ApiError ? error : null;
  const sessionExpired = apiError?.status === 401;
  return (
    <PageMessage
      title={sessionExpired ? t("app.sessionExpired") : t("app.unknownError")}
      body={sessionExpired ? t("app.signInAgain") : (apiError?.message ?? t("app.networkError"))}
      actions={
        sessionExpired ? (
          <Button onClick={() => window.location.reload()}>{t("app.signInAgain")}</Button>
        ) : onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            <IconRefresh size={18} />
            {t("app.retry")}
          </Button>
        ) : null
      }
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={clsx("skeleton", className)} aria-hidden="true" />;
}

export function LoadingPage({ variant = "cards" }: { variant?: "dashboard" | "cards" | "form" }) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx("loading-page", `loading-page--${variant}`)}
      role="status"
      aria-label={t("app.loading")}
    >
      <Skeleton className="skeleton--heading" />
      <Skeleton className="skeleton--wide" />
      <div className="loading-page__grid">
        <Skeleton className="skeleton--card" />
        <Skeleton className="skeleton--card" />
        <Skeleton className="skeleton--card" />
      </div>
    </div>
  );
}

export function Dialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function restoreFocus() {
    const element = returnFocusRef.current;
    returnFocusRef.current = null;
    window.requestAnimationFrame(() => element?.focus());
  }

  function handleBackdropPointer(event: MouseEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside && !busy) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      onMouseDown={handleBackdropPointer}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        restoreFocus();
        if (open) onClose();
      }}
    >
      <IconButton className="dialog__close" label={t("app.close")} onClick={onClose}>
        <IconX size={20} />
      </IconButton>
      <h2 id={titleId}>{title}</h2>
      <p>{body}</p>
      <div className="dialog__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy} autoFocus>
          {t("app.cancel")}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy ? t("app.saving") : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: PropsWithChildren<{
  id?: string | undefined;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
}>) {
  const generatedId = useId();
  const fieldId = id ?? `field-${generatedId.replaceAll(":", "")}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  function enhanceControl(child: ReactNode): ReactNode {
    if (!isValidElement<Record<string, unknown>>(child)) return child;
    if (typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type)) {
      const existingDescription = child.props["aria-describedby"];
      return cloneElement(child, {
        id: child.props.id ?? fieldId,
        "aria-describedby":
          [typeof existingDescription === "string" ? existingDescription : null, describedBy]
            .filter(Boolean)
            .join(" ") || undefined,
        "aria-invalid": error ? true : child.props["aria-invalid"],
      });
    }
    if (child.type === "span") {
      return cloneElement(
        child,
        undefined,
        Children.map(child.props.children as ReactNode, enhanceControl),
      );
    }
    return child;
  }

  const enhancedChildren = Children.map(children, enhanceControl);

  return (
    <label className={clsx("field", className)} htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      {enhancedChildren}
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function InlineNotice({
  children,
  tone = "info",
}: PropsWithChildren<{ tone?: "info" | "danger" | "success" }>) {
  return <div className={clsx("inline-notice", `inline-notice--${tone}`)}>{children}</div>;
}

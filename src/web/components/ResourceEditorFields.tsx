import { IconChevronDown } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { ResourceSymbol } from "../../domain/symbol";
import type { PaymentMethodKind } from "../api/types";
import { Field } from "./ui";
import { SymbolPicker } from "./SymbolPicker";
import { useSymbolPickerCopy } from "./useSymbolPickerCopy";

export function CategoryEditorFields({
  defaultName = "",
  defaultColor = "#4F7CFF",
  symbol,
  onSymbolChange,
  disabled = false,
  autoFocus = false,
}: {
  defaultName?: string;
  defaultColor?: string;
  symbol: ResourceSymbol;
  onSymbolChange: (symbol: ResourceSymbol) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const symbolPicker = useSymbolPickerCopy();
  return (
    <>
      <Field label={t("settings.categoryName")}>
        <input
          name="name"
          maxLength={80}
          defaultValue={defaultName}
          required
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </Field>
      <Field label={t("settings.color")}>
        <input name="color" type="color" defaultValue={defaultColor} disabled={disabled} />
      </Field>
      <SymbolPicker
        value={symbol}
        onChange={onSymbolChange}
        disabled={disabled}
        {...symbolPicker}
      />
    </>
  );
}

export function PaymentMethodEditorFields({
  defaultName = "",
  defaultKind = "card",
  defaultLabel = "",
  symbol,
  onSymbolChange,
  disabled = false,
  autoFocus = false,
}: {
  defaultName?: string;
  defaultKind?: PaymentMethodKind;
  defaultLabel?: string;
  symbol: ResourceSymbol;
  onSymbolChange: (symbol: ResourceSymbol) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const symbolPicker = useSymbolPickerCopy();
  return (
    <>
      <Field label={t("settings.paymentName")}>
        <input
          name="name"
          maxLength={80}
          defaultValue={defaultName}
          required
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </Field>
      <Field label={t("settings.paymentKind")}>
        <span className="select-wrap">
          <select name="kind" defaultValue={defaultKind} disabled={disabled}>
            {(["card", "wallet", "bank", "store", "other"] as const).map((kind) => (
              <option value={kind} key={kind}>
                {t(`settings.kinds.${kind}`)}
              </option>
            ))}
          </select>
          <IconChevronDown size={17} aria-hidden="true" />
        </span>
      </Field>
      <Field label={t("settings.paymentLabel")} hint={t("form.safePaymentLabelHint")}>
        <input
          name="label"
          maxLength={80}
          defaultValue={defaultLabel}
          placeholder={t("settings.paymentLabelPlaceholder")}
          disabled={disabled}
        />
      </Field>
      <SymbolPicker
        value={symbol}
        onChange={onSymbolChange}
        disabled={disabled}
        {...symbolPicker}
      />
    </>
  );
}

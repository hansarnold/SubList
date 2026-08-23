import { createElement, type KeyboardEvent, useId, useRef, useState } from "react";
import {
  COMMON_ICON_KEYS,
  normalizeResourceSymbol,
  type CommonIconKey,
  type ResourceSymbol,
} from "../../domain/symbol";
import { COMMON_ICON_REGISTRY } from "../symbols/icon-registry";

export type EmojiOption = {
  readonly label: string;
  readonly value: string;
};

export type SymbolPickerLabels = {
  readonly clear: string;
  readonly commonIcons: string;
  readonly emoji: string;
  readonly emojiInput: string;
  readonly emojiInputPlaceholder?: string;
  readonly invalidEmoji: string;
  readonly legend: string;
};

export type SymbolPickerProps = {
  readonly disabled?: boolean;
  readonly emojiOptions: readonly EmojiOption[];
  readonly iconLabels: Readonly<Record<CommonIconKey, string>>;
  readonly labels: SymbolPickerLabels;
  readonly onChange: (symbol: ResourceSymbol) => void;
  readonly value: ResourceSymbol;
};

type PickerTab = "icons" | "emoji";

export function SymbolPicker({
  disabled = false,
  emojiOptions,
  iconLabels,
  labels,
  onChange,
  value,
}: SymbolPickerProps) {
  const generatedId = useId().replaceAll(":", "");
  const radioName = `resource-symbol-${generatedId}`;
  const iconTabId = `${generatedId}-icons-tab`;
  const emojiTabId = `${generatedId}-emoji-tab`;
  const iconPanelId = `${generatedId}-icons-panel`;
  const emojiPanelId = `${generatedId}-emoji-panel`;
  const emojiErrorId = `${generatedId}-emoji-error`;
  const [activeTab, setActiveTab] = useState<PickerTab>(
    value?.type === "emoji" ? "emoji" : "icons",
  );
  const [emojiDraft, setEmojiDraft] = useState(value?.type === "emoji" ? value.value : "");
  const [emojiError, setEmojiError] = useState<string | null>(null);
  const valueKey = value === null ? "null" : `${value.type}:${value.value}`;
  const [previousValueKey, setPreviousValueKey] = useState(valueKey);
  const iconTabRef = useRef<HTMLButtonElement>(null);
  const emojiTabRef = useRef<HTMLButtonElement>(null);

  if (previousValueKey !== valueKey) {
    setPreviousValueKey(valueKey);
    setEmojiDraft(value?.type === "emoji" ? value.value : "");
    setEmojiError(null);
    setActiveTab(value?.type === "emoji" ? "emoji" : "icons");
  }

  function activateTab(tab: PickerTab, moveFocus = false) {
    setActiveTab(tab);
    if (moveFocus) {
      window.requestAnimationFrame(() => {
        (tab === "icons" ? iconTabRef : emojiTabRef).current?.focus();
      });
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextTab: PickerTab | null = null;
    if (event.key === "Home") {
      nextTab = "icons";
    } else if (event.key === "End") {
      nextTab = "emoji";
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextTab = activeTab === "icons" ? "emoji" : "icons";
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextTab = activeTab === "icons" ? "emoji" : "icons";
    }
    if (!nextTab) return;
    event.preventDefault();
    activateTab(nextTab, true);
  }

  function selectEmoji(rawValue: string) {
    setEmojiDraft(rawValue);
    if (rawValue.trim().length === 0) {
      setEmojiError(null);
      return;
    }

    try {
      const normalized = normalizeResourceSymbol({ type: "emoji", value: rawValue });
      if (!normalized || normalized.type !== "emoji") throw new Error("Expected an emoji symbol.");
      setEmojiError(null);
      setEmojiDraft(normalized.value);
      onChange(normalized);
    } catch {
      setEmojiError(labels.invalidEmoji);
    }
  }

  function clearSelection() {
    setEmojiDraft("");
    setEmojiError(null);
    onChange(null);
  }

  return (
    <fieldset className="symbol-picker" disabled={disabled}>
      <legend className="symbol-picker__legend">{labels.legend}</legend>
      <div className="symbol-picker__tabs" role="tablist" aria-label={labels.legend}>
        <button
          ref={iconTabRef}
          id={iconTabId}
          type="button"
          role="tab"
          aria-controls={iconPanelId}
          aria-selected={activeTab === "icons"}
          tabIndex={activeTab === "icons" ? 0 : -1}
          disabled={disabled}
          onClick={() => activateTab("icons")}
          onKeyDown={handleTabKeyDown}
        >
          {labels.commonIcons}
        </button>
        <button
          ref={emojiTabRef}
          id={emojiTabId}
          type="button"
          role="tab"
          aria-controls={emojiPanelId}
          aria-selected={activeTab === "emoji"}
          tabIndex={activeTab === "emoji" ? 0 : -1}
          disabled={disabled}
          onClick={() => activateTab("emoji")}
          onKeyDown={handleTabKeyDown}
        >
          {labels.emoji}
        </button>
      </div>

      <div
        id={iconPanelId}
        className="symbol-picker__panel"
        role="tabpanel"
        aria-labelledby={iconTabId}
        hidden={activeTab !== "icons"}
      >
        <div className="symbol-picker__choices symbol-picker__choices--icons">
          {COMMON_ICON_KEYS.map((key) => {
            const label = iconLabels[key];
            return (
              <label className="symbol-picker__choice" key={key}>
                <input
                  type="radio"
                  name={radioName}
                  value={key}
                  checked={value?.type === "icon" && value.value === key}
                  onChange={() => onChange({ type: "icon", value: key })}
                />
                {createElement(COMMON_ICON_REGISTRY[key], {
                  "aria-hidden": true,
                  focusable: "false",
                  size: 22,
                  stroke: 1.8,
                })}
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div
        id={emojiPanelId}
        className="symbol-picker__panel"
        role="tabpanel"
        aria-labelledby={emojiTabId}
        hidden={activeTab !== "emoji"}
      >
        <div className="symbol-picker__choices symbol-picker__choices--emoji">
          {emojiOptions.map((option) => (
            <label className="symbol-picker__choice" key={option.value}>
              <input
                type="radio"
                name={radioName}
                value={option.value}
                checked={value?.type === "emoji" && value.value === option.value}
                onChange={() => selectEmoji(option.value)}
              />
              <span className="symbol-picker__emoji" aria-hidden="true">
                {option.value}
              </span>
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <label className="symbol-picker__emoji-input">
          <span>{labels.emojiInput}</span>
          <input
            type="text"
            value={emojiDraft}
            placeholder={labels.emojiInputPlaceholder}
            aria-describedby={emojiError ? emojiErrorId : undefined}
            aria-invalid={emojiError ? true : undefined}
            onChange={(event) => selectEmoji(event.target.value)}
          />
        </label>
        {emojiError ? (
          <p id={emojiErrorId} className="symbol-picker__error" role="status">
            {emojiError}
          </p>
        ) : null}
      </div>

      <button
        className="symbol-picker__clear"
        type="button"
        disabled={disabled || value === null}
        onClick={clearSelection}
      >
        {labels.clear}
      </button>
    </fieldset>
  );
}

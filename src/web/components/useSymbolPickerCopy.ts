import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { COMMON_ICON_KEYS, type CommonIconKey } from "../../domain/symbol";
import type { EmojiOption, SymbolPickerLabels } from "./SymbolPicker";

export function useSymbolPickerCopy(): {
  emojiOptions: readonly EmojiOption[];
  iconLabels: Readonly<Record<CommonIconKey, string>>;
  labels: SymbolPickerLabels;
} {
  const { t } = useTranslation();
  return useMemo(() => {
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
  }, [t]);
}

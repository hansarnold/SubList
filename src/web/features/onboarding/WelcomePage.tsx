import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChevronDown, IconListDetails, IconSparkles } from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { categoriesQueryKey } from "../../api/query-keys";
import type { Category, Session } from "../../api/types";
import { CategorySymbol } from "../../components/ResourceSymbol";
import { Button, Field, InlineNotice } from "../../components/ui";
import { normalizeCategoryNameKey } from "../../../domain/text-normalization";
import {
  CATEGORY_PRESETS,
  RECOMMENDED_CATEGORY_PRESET_KEYS,
  type CategoryPresetKey,
} from "../../../shared/presets";
import { setLanguage } from "../../i18n";

type OnboardingMode = "recommended" | "empty";
type SupportedLanguage = "en" | "zh-Hans";

const recommendedPresetKeySet: ReadonlySet<CategoryPresetKey> = new Set(
  RECOMMENDED_CATEGORY_PRESET_KEYS,
);
const recommendedPresets = CATEGORY_PRESETS.filter((preset) =>
  recommendedPresetKeySet.has(preset.key),
);

function browserTimeZone(fallback: string): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}

function formValue(values: FormData, name: string): string {
  const value = values.get(name);
  return typeof value === "string" ? value : "";
}

export function WelcomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: api.session });
  const session = sessionQuery.data;
  const userId = session?.user.id ?? "pending";
  const initialLanguage: SupportedLanguage = i18n.language.startsWith("zh") ? "zh-Hans" : "en";
  const [language, setSelectedLanguage] = useState<SupportedLanguage>(initialLanguage);
  const [mode, setMode] = useState<OnboardingMode>("recommended");
  const [selectedPresetKeys, setSelectedPresetKeys] = useState<ReadonlySet<CategoryPresetKey>>(
    () => new Set(RECOMMENDED_CATEGORY_PRESET_KEYS),
  );

  const mutation = useMutation({
    mutationFn: async (input: {
      displayName: string | null;
      timezone: string;
      reportingCurrency: string;
      language: SupportedLanguage;
      presetKeys: readonly CategoryPresetKey[];
    }) => {
      await setLanguage(input.language);
      const fixedT = i18n.getFixedT(input.language);
      await api.updateMe({
        displayName: input.displayName,
        timezone: input.timezone,
        reportingCurrency: input.reportingCurrency,
        preferredLocale: input.language,
      });

      const existingCategories = await api.categories();
      const existingNames = new Set(
        existingCategories.map((category) => normalizeCategoryNameKey(category.name)),
      );
      const selected = CATEGORY_PRESETS.filter((preset) => input.presetKeys.includes(preset.key));
      const missing = selected
        .map((preset) => ({
          name: fixedT(preset.labelKey),
          color: preset.color,
          symbol: preset.symbol,
        }))
        .filter((preset) => !existingNames.has(normalizeCategoryNameKey(preset.name)))
        .map((preset, index) => ({ ...preset, position: existingCategories.length + index }));

      let categories = existingCategories;
      if (missing.length > 0) {
        const created = await api.createCategoriesBatch(missing);
        categories = [...existingCategories, ...created];
        queryClient.setQueryData<Category[]>(categoriesQueryKey(userId), categories);
      }

      const user = await api.completeOnboarding();
      return { user, categories };
    },
    onSuccess: async ({ user, categories }) => {
      queryClient.setQueryData(["me"], user);
      queryClient.setQueryData<Category[]>(categoriesQueryKey(user.id), categories);
      queryClient.setQueryData<Session | undefined>(["session"], (current) =>
        current ? { ...current, user } : current,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: categoriesQueryKey(user.id) }),
      ]);
      void navigate("/dashboard", { replace: true });
    },
  });

  if (!session) return null;
  const user = session.user;

  function togglePreset(key: CategoryPresetKey) {
    setSelectedPresetKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const reportingCurrency = formValue(values, "reportingCurrency").trim().toUpperCase();
    mutation.mutate({
      displayName: formValue(values, "displayName").trim() || null,
      timezone: formValue(values, "timezone").trim(),
      reportingCurrency,
      language,
      presetKeys: mode === "recommended" ? [...selectedPresetKeys] : [],
    });
  }

  return (
    <div className="page page--settings">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{t("app.name")}</p>
          <h1>{t("onboarding.title")}</h1>
        </div>
        <span className="brand__mark" aria-hidden="true">
          <IconListDetails size={23} stroke={2.1} />
        </span>
      </header>

      <section className="surface settings-panel">
        <header className="settings-panel__header">
          <div>
            <h2>{t("onboarding.profileTitle")}</h2>
            <p>{t("onboarding.intro")}</p>
          </div>
        </header>

        {mutation.isError ? (
          <InlineNotice tone="danger">{mutation.error.message}</InlineNotice>
        ) : null}

        <form className="settings-form" onSubmit={submit}>
          <div className="field-row">
            <Field label={t("app.language")}>
              <span className="select-wrap">
                <select
                  value={language}
                  onChange={(event) => {
                    const next = event.target.value as SupportedLanguage;
                    setSelectedLanguage(next);
                    void setLanguage(next);
                  }}
                >
                  <option value="en">{t("app.english")}</option>
                  <option value="zh-Hans">{t("app.chinese")}</option>
                </select>
                <IconChevronDown size={17} />
              </span>
            </Field>
            <Field label={t("settings.displayName")} hint={t("onboarding.displayNameHint")}>
              <input name="displayName" maxLength={120} defaultValue={user.displayName ?? ""} />
            </Field>
          </div>

          <div className="field-row">
            <Field label={t("settings.timezone")} hint={t("onboarding.timezoneHint")}>
              <input
                name="timezone"
                defaultValue={browserTimeZone(user.timezone)}
                required
                autoComplete="off"
              />
            </Field>
            <Field
              label={t("settings.reportingCurrency")}
              hint={t("onboarding.reportingCurrencyHint")}
            >
              <input
                name="reportingCurrency"
                maxLength={3}
                pattern="[A-Za-z]{3}"
                defaultValue={user.reportingCurrency}
                required
                autoCapitalize="characters"
                autoComplete="off"
              />
            </Field>
          </div>

          <fieldset className="settings-form">
            <legend>
              <strong>{t("onboarding.categoriesTitle")}</strong>
            </legend>
            <p>{t("onboarding.categoriesIntro")}</p>
            <label className="checkbox-field">
              <input
                type="radio"
                name="categoryMode"
                value="recommended"
                checked={mode === "recommended"}
                onChange={() => setMode("recommended")}
              />
              <span>
                <strong>{t("onboarding.useRecommended")}</strong>
                <small>{t("onboarding.useRecommendedHint")}</small>
              </span>
            </label>
            <div className="resource-list">
              {recommendedPresets.map((preset) => {
                const name = t(preset.labelKey);
                return (
                  <label className="resource-row checkbox-field" key={preset.key}>
                    <input
                      type="checkbox"
                      checked={selectedPresetKeys.has(preset.key)}
                      disabled={mode === "empty"}
                      onChange={() => togglePreset(preset.key)}
                    />
                    <CategorySymbol symbol={preset.symbol} color={preset.color} size={22} />
                    <span>
                      <strong>{name}</strong>
                      <small>{t("onboarding.categoryWillBeCreated")}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <label className="checkbox-field">
              <input
                type="radio"
                name="categoryMode"
                value="empty"
                checked={mode === "empty"}
                onChange={() => setMode("empty")}
              />
              <span>
                <strong>{t("onboarding.startEmpty")}</strong>
                <small>{t("onboarding.startEmptyHint")}</small>
              </span>
            </label>
          </fieldset>

          <InlineNotice>
            <IconSparkles size={19} aria-hidden="true" />
            {t("onboarding.reviewNotice")}
          </InlineNotice>
          <div className="settings-form__actions">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("onboarding.finishing") : t("onboarding.finish")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

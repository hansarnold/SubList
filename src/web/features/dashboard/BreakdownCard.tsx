import { IconChartBar, IconChartDonut, IconInfoCircle } from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FxStatus } from "../../api/types";
import { InlineNotice } from "../../components/ui";
import { formatDate, formatMoney } from "../../utils/format";
import { buildBreakdownModel, type BreakdownInput, type BreakdownRow } from "./breakdown-model";

type BreakdownView = "bars" | "donut";

function readSavedView(storageKey: string): BreakdownView {
  return localStorage.getItem(storageKey) === "donut" ? "donut" : "bars";
}

function formatShare(share: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(share / 100);
}

export function BreakdownTooltip({
  active,
  payload,
  currency,
  locale,
  accessibilityLayer,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  currency: string;
  locale: string;
  accessibilityLayer?: boolean;
}) {
  if (!active) return null;
  const row = payload?.[0]?.payload as BreakdownRow | undefined;
  if (!row?.reportingMonthlyAverage) return null;
  return (
    <div
      className="breakdown-tooltip"
      role={accessibilityLayer ? "status" : undefined}
      aria-live={accessibilityLayer ? "polite" : undefined}
      aria-atomic={accessibilityLayer ? true : undefined}
    >
      <strong>{row.label}</strong>
      <span>{formatMoney(row.reportingMonthlyAverage, currency, locale)}</span>
      {row.share === null ? null : <small>{formatShare(row.share, locale)}</small>}
    </div>
  );
}

function FxMetadata({ fx, locale }: { fx: FxStatus; locale: string }) {
  const { t } = useTranslation();
  if (fx.state === "not_needed") {
    return <span>{t("dashboard.fxNotNeeded")}</span>;
  }
  if (fx.state === "unavailable") {
    return (
      <span>
        {t("dashboard.fxUnavailable")}
        {fx.missingCurrencies.length
          ? ` ${t("dashboard.fxMissingCurrencies", { currencies: fx.missingCurrencies.join(", ") })}`
          : ""}
      </span>
    );
  }
  return (
    <span>
      {t("dashboard.fxSourceDate", {
        provider: fx.provider?.toUpperCase() ?? "ECB",
        date: formatDate(fx.rateDate, locale) ?? fx.rateDate,
      })}
      {` · ${t(fx.state === "fresh" ? "dashboard.fxFresh" : "dashboard.fxStale")}`}
    </span>
  );
}

function BreakdownChart({
  view,
  rows,
  currency,
  locale,
  label,
}: {
  view: BreakdownView;
  rows: BreakdownRow[];
  currency: string;
  locale: string;
  label: string;
}) {
  if (view === "donut") {
    return (
      <div className="breakdown-chart breakdown-chart--donut" role="group" aria-label={label}>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart accessibilityLayer title={label}>
            <Pie
              data={rows}
              dataKey="chartValue"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={98}
              paddingAngle={2}
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell key={row.key} fill={row.chartColor} stroke="var(--surface-raised)" />
              ))}
            </Pie>
            <Tooltip
              content={(props) => (
                <BreakdownTooltip
                  active={props.active}
                  payload={props.payload}
                  currency={currency}
                  locale={locale}
                  accessibilityLayer={props.accessibilityLayer}
                />
              )}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="breakdown-chart__legend" aria-hidden="true">
          {rows.map((row) => (
            <span key={row.key}>
              <i style={{ background: row.chartColor }} />
              {row.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="breakdown-chart breakdown-chart--bars" role="group" aria-label={label}>
      <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 54)}>
        <BarChart
          data={rows}
          layout="vertical"
          accessibilityLayer
          title={label}
          margin={{ top: 8, right: 18, bottom: 8, left: 8 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 4" />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="label"
            axisLine={false}
            tickLine={false}
            width={112}
            tick={{ fill: "var(--text-soft)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-subtle)" }}
            content={(props) => (
              <BreakdownTooltip
                active={props.active}
                payload={props.payload}
                currency={currency}
                locale={locale}
                accessibilityLayer={props.accessibilityLayer}
              />
            )}
          />
          <Bar dataKey="chartValue" radius={[0, 7, 7, 0]} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.key} fill={row.chartColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BreakdownCard({
  title,
  storageKey,
  items,
  currency,
  fx,
  locale,
  renderSymbol,
}: {
  title: string;
  storageKey: string;
  items: readonly BreakdownInput[];
  currency: string;
  fx: FxStatus;
  locale: string;
  renderSymbol: (item: BreakdownInput) => ReactNode;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<BreakdownView>(() => readSavedView(storageKey));
  const model = useMemo(() => buildBreakdownModel(items, t("dashboard.other")), [items, t]);

  useEffect(() => {
    localStorage.setItem(storageKey, view);
  }, [storageKey, view]);

  const hasChart = model.state === "ready";
  return (
    <section className="surface breakdown-card">
      <div className="section-heading-row breakdown-card__heading">
        <div>
          <h2>{title}</h2>
          <p>
            {t("dashboard.estimatedMonthlyAverage")} · {currency}
          </p>
        </div>
        {hasChart ? (
          <div className="segmented-control breakdown-card__view" role="group" aria-label={title}>
            <button
              type="button"
              className={view === "bars" ? "is-selected" : ""}
              aria-pressed={view === "bars"}
              onClick={() => setView("bars")}
            >
              <IconChartBar size={18} aria-hidden="true" />
              {t("dashboard.bars")}
            </button>
            <button
              type="button"
              className={view === "donut" ? "is-selected" : ""}
              aria-pressed={view === "donut"}
              onClick={() => setView("donut")}
            >
              <IconChartDonut size={18} aria-hidden="true" />
              {t("dashboard.donut")}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`breakdown-card__fx breakdown-card__fx--${fx.state}`}
        role={fx.state === "unavailable" ? "alert" : "status"}
      >
        <IconInfoCircle size={16} aria-hidden="true" />
        <FxMetadata fx={fx} locale={locale} />
      </div>

      {model.state === "empty" ? (
        <p className="breakdown-card__state">{t("dashboard.noBreakdownData")}</p>
      ) : null}
      {model.state === "unavailable" ? (
        <InlineNotice tone="danger">{t("dashboard.breakdownUnavailable")}</InlineNotice>
      ) : null}
      {model.state === "zero" ? (
        <p className="breakdown-card__state">{t("dashboard.zeroBreakdown")}</p>
      ) : null}
      {model.state === "single" && model.chartRows[0] ? (
        <div className="breakdown-card__single">
          <span>{model.chartRows[0].label}</span>
          <strong>
            {formatMoney(model.chartRows[0].reportingMonthlyAverage ?? "0", currency, locale)}
          </strong>
          <small>{t("dashboard.fullShare")}</small>
        </div>
      ) : null}
      {hasChart ? (
        <BreakdownChart
          view={view}
          rows={model.chartRows}
          currency={currency}
          locale={locale}
          label={t("dashboard.breakdownChartLabel", {
            title,
            view: t(`dashboard.${view}`),
            currency,
          })}
        />
      ) : null}

      {model.rows.length ? (
        <ol className="breakdown-list" aria-label={t("dashboard.breakdownTextList", { title })}>
          {model.rows.map((row) => (
            <li key={row.key}>
              <div className="breakdown-list__identity">
                {renderSymbol(row)}
                <span>
                  <strong>{row.label}</strong>
                  <small>{t("dashboard.subscriptions", { count: row.subscriptionCount })}</small>
                </span>
              </div>
              <div className="breakdown-list__amount">
                <strong>
                  {row.reportingMonthlyAverage === null
                    ? t("app.notAvailable")
                    : formatMoney(row.reportingMonthlyAverage, currency, locale)}
                </strong>
                {row.share === null ? null : <small>≈ {formatShare(row.share, locale)}</small>}
              </div>
              <ul
                className="breakdown-list__original"
                aria-label={t("dashboard.originalCurrencyAmounts")}
              >
                {row.totalsByCurrency.map((total) => (
                  <li key={total.currency}>
                    <span>{total.currency}</span>
                    <span>{formatMoney(total.monthlyEstimate, total.currency, locale)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

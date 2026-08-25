import { type ReactNode, useMemo } from "react";
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
import { InlineNotice } from "../../components/ui";
import { formatMoney } from "../../utils/format";
import { buildBreakdownModel, type BreakdownInput, type BreakdownRow } from "./breakdown-model";

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

function BreakdownBarChart({
  rows,
  currency,
  locale,
  title,
  label,
}: {
  rows: BreakdownRow[];
  currency: string;
  locale: string;
  title: string;
  label: string;
}) {
  const height = Math.min(420, Math.max(250, rows.length * 54));
  return (
    <section className="breakdown-chart-panel">
      <h3>{title}</h3>
      <div className="breakdown-chart breakdown-chart--bars" role="group" aria-label={label}>
        <ResponsiveContainer width="100%" height={height}>
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
    </section>
  );
}

function BreakdownPieChart({
  rows,
  currency,
  locale,
  title,
  label,
}: {
  rows: BreakdownRow[];
  currency: string;
  locale: string;
  title: string;
  label: string;
}) {
  return (
    <section className="breakdown-chart-panel">
      <h3>{title}</h3>
      <div className="breakdown-chart breakdown-chart--pie" role="group" aria-label={label}>
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
              paddingAngle={rows.length > 1 ? 2 : 0}
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
        <ul className="breakdown-chart__legend" aria-hidden="true">
          {rows.map((row) => (
            <li key={row.key}>
              <i style={{ background: row.chartColor }} />
              <span>{row.label}</span>
              {row.share === null ? null : <small>{formatShare(row.share, locale)}</small>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function BreakdownTable({
  title,
  rows,
  currency,
  locale,
  renderSymbol,
}: {
  title: string;
  rows: BreakdownRow[];
  currency: string;
  locale: string;
  renderSymbol: (item: BreakdownInput) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="breakdown-table-wrap">
      <table className="breakdown-table">
        <caption>{t("dashboard.breakdownTableCaption", { title, currency })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("dashboard.group")}</th>
            <th scope="col">{t("dashboard.subscriptionCount")}</th>
            <th scope="col">
              {t("dashboard.estimatedMonthlyAverage")} ({currency})
            </th>
            <th scope="col">{t("dashboard.share")}</th>
            <th scope="col">{t("dashboard.originalCurrencyAmounts")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <span className="breakdown-table__identity">
                  <span aria-hidden="true">{renderSymbol(row)}</span>
                  <strong>{row.label}</strong>
                </span>
              </th>
              <td>{row.subscriptionCount}</td>
              <td className="breakdown-table__number">
                {row.reportingMonthlyAverage === null
                  ? t("dashboard.unavailable")
                  : formatMoney(row.reportingMonthlyAverage, currency, locale)}
              </td>
              <td className="breakdown-table__number">
                {row.share === null ? t("dashboard.unavailable") : formatShare(row.share, locale)}
              </td>
              <td>
                <ul
                  className="breakdown-table__original"
                  aria-label={t("dashboard.originalCurrencyAmountsFor", { group: row.label })}
                >
                  {row.totalsByCurrency.map((total) => (
                    <li key={total.currency}>
                      <span>{total.currency}</span>
                      <span>{formatMoney(total.monthlyEstimate, total.currency, locale)}</span>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BreakdownCard({
  title,
  barTitle,
  pieTitle,
  items,
  currency,
  locale,
  renderSymbol,
}: {
  title: string;
  barTitle: string;
  pieTitle: string;
  items: readonly BreakdownInput[];
  currency: string;
  locale: string;
  renderSymbol: (item: BreakdownInput) => ReactNode;
}) {
  const { t } = useTranslation();
  const model = useMemo(() => buildBreakdownModel(items, t("dashboard.other")), [items, t]);
  const hasCharts = model.state === "single" || model.state === "ready";

  return (
    <section className="surface breakdown-card">
      <div className="breakdown-card__heading">
        <h2>{title}</h2>
        <p>
          {t("dashboard.estimatedMonthlyAverage")} · {currency}
        </p>
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

      {hasCharts ? (
        <div className="breakdown-visuals">
          <BreakdownBarChart
            rows={model.chartRows}
            currency={currency}
            locale={locale}
            title={barTitle}
            label={t("dashboard.breakdownBarLabel", { title: barTitle, currency })}
          />
          <BreakdownPieChart
            rows={model.chartRows}
            currency={currency}
            locale={locale}
            title={pieTitle}
            label={t("dashboard.breakdownPieLabel", { title: pieTitle, currency })}
          />
        </div>
      ) : null}

      {model.rows.length ? (
        <BreakdownTable
          title={title}
          rows={model.rows}
          currency={currency}
          locale={locale}
          renderSymbol={renderSymbol}
        />
      ) : null}
    </section>
  );
}

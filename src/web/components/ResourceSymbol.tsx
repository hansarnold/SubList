import {
  IconBuildingBank,
  IconBuildingStore,
  IconCreditCard,
  IconDots,
  IconWallet,
  type TablerIcon,
} from "@tabler/icons-react";
import { createElement, type CSSProperties, type ReactNode } from "react";
import type { ResourceSymbol } from "../../domain/symbol";
import type { PaymentMethodKind } from "../../shared/api-types";
import { serviceMonogram } from "../utils/format";
import { COMMON_ICON_REGISTRY } from "../symbols/icon-registry";

type SymbolSizeProps = {
  className?: string | undefined;
  size?: number | undefined;
};

type SymbolGlyphProps = SymbolSizeProps & {
  symbol: Exclude<ResourceSymbol, null>;
  stroke?: number | undefined;
};

const PAYMENT_FALLBACK_ICONS = {
  bank: IconBuildingBank,
  card: IconCreditCard,
  other: IconDots,
  store: IconBuildingStore,
  wallet: IconWallet,
} as const satisfies Readonly<Record<PaymentMethodKind, TablerIcon>>;

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function DecorativeFrame({
  children,
  className,
  size = 24,
  style,
  variant,
}: SymbolSizeProps & {
  children: ReactNode;
  style?: CSSProperties | undefined;
  variant: string;
}) {
  return (
    <span
      className={classNames("resource-symbol", `resource-symbol--${variant}`, className)}
      aria-hidden="true"
      style={{
        alignItems: "center",
        display: "inline-flex",
        flex: "0 0 auto",
        height: size,
        justifyContent: "center",
        lineHeight: 1,
        width: size,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function SymbolGlyph({ symbol, className, size = 24, stroke = 1.8 }: SymbolGlyphProps) {
  if (symbol.type === "emoji") {
    return (
      <DecorativeFrame
        className={className}
        size={size}
        variant="emoji"
        style={{ fontSize: Math.max(14, Math.round(size * 0.75)) }}
      >
        {symbol.value}
      </DecorativeFrame>
    );
  }

  return (
    <DecorativeFrame className={className} size={size} variant="icon">
      {createElement(COMMON_ICON_REGISTRY[symbol.value], {
        "aria-hidden": true,
        focusable: "false",
        size,
        stroke,
      })}
    </DecorativeFrame>
  );
}

export function CategorySymbol({
  symbol,
  color,
  className,
  size = 20,
}: SymbolSizeProps & {
  symbol: ResourceSymbol;
  color: string;
}) {
  if (symbol) return <SymbolGlyph symbol={symbol} className={className} size={size} />;

  const dotSize = Math.max(8, Math.round(size * 0.5));
  return (
    <DecorativeFrame className={className} size={size} variant="category-fallback">
      <span
        style={{
          backgroundColor: color,
          borderRadius: "999px",
          height: dotSize,
          width: dotSize,
        }}
      />
    </DecorativeFrame>
  );
}

export function PaymentMethodSymbol({
  symbol,
  kind,
  className,
  size = 20,
}: SymbolSizeProps & {
  symbol: ResourceSymbol;
  kind: PaymentMethodKind;
}) {
  if (symbol) return <SymbolGlyph symbol={symbol} className={className} size={size} />;

  const FallbackIcon = PAYMENT_FALLBACK_ICONS[kind];
  return (
    <DecorativeFrame className={className} size={size} variant="payment-fallback">
      <FallbackIcon size={size} stroke={1.8} aria-hidden="true" focusable="false" />
    </DecorativeFrame>
  );
}

export function SubscriptionSymbol({
  symbol,
  name,
  color,
  className,
  size = 44,
}: SymbolSizeProps & {
  symbol: ResourceSymbol;
  name: string;
  color?: string | null | undefined;
}) {
  if (symbol) return <SymbolGlyph symbol={symbol} className={className} size={size} />;

  return (
    <DecorativeFrame
      className={className}
      size={size}
      variant="subscription-fallback"
      style={{
        border: "1px solid currentColor",
        borderRadius: Math.max(8, Math.round(size * 0.22)),
        color: color ?? undefined,
        fontSize: Math.max(11, Math.round(size * 0.28)),
        fontWeight: 650,
      }}
    >
      {serviceMonogram(name)}
    </DecorativeFrame>
  );
}

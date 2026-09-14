import type { EarningsGrowthState, SoxEarningsGrowth } from "@/types";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatNumber(
  value: unknown,
  options: Intl.NumberFormatOptions = {}
): string {
  if (!isFiniteNumber(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    ...options
  }).format(value);
}

export function formatCurrency(value: unknown): string {
  if (!isFiniteNumber(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 100 ? 0 : 2
  }).format(value);
}

export function formatCompact(value: unknown): string {
  if (!isFiniteNumber(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

export function formatPercent(value: unknown): string {
  if (!isFiniteNumber(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

const growthStatePresentation: Partial<
  Record<EarningsGrowthState, { label: string; className: string }>
> = {
  turnaround: { label: "흑자전환", className: "positive" },
  loss_narrowing: { label: "적자축소", className: "positive" },
  loss_widening: { label: "적자확대", className: "negative" },
  unchanged_loss: { label: "적자유지", className: "" },
  loss_to_breakeven: { label: "손익분기", className: "positive" },
  profit_from_zero: { label: "흑자발생", className: "positive" },
  loss_from_zero: { label: "적자발생", className: "negative" },
  unchanged_zero: { label: "0 유지", className: "" }
};

function earningsStatePresentation(growth: SoxEarningsGrowth | undefined) {
  const state = growth?.state;
  return state && Object.hasOwn(growthStatePresentation, state)
    ? growthStatePresentation[state]
    : undefined;
}

export function formatEarningsGrowth(
  value: unknown,
  growth?: SoxEarningsGrowth
): string {
  if (isFiniteNumber(value)) return formatPercent(value);
  return earningsStatePresentation(growth)?.label || "-";
}

export function earningsGrowthClass(
  value: unknown,
  growth?: SoxEarningsGrowth
): string {
  if (isFiniteNumber(value)) return numberClass(value);
  return earningsStatePresentation(growth)?.className || "";
}

export function formatScore(value: unknown): string {
  if (!isFiniteNumber(value)) return "-";
  return Math.round(value * 100).toString();
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  return value.slice(0, 10);
}

export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  return value.replace("T", " ").replace("Z", " UTC");
}

export function scoreClass(value: unknown): string {
  if (!isFiniteNumber(value)) return "";
  if (value >= 0.67) return "good";
  if (value < 0.35) return "bad";
  return "watch";
}

export function numberClass(value: unknown): string {
  if (!isFiniteNumber(value)) return "";
  return value >= 0 ? "positive" : "negative";
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

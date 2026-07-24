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

import type {
  SortDirection,
  SortKey,
  SoxConstituent
} from "@/types";

export function defaultDirectionFor(key: SortKey): SortDirection {
  return ["rank", "ticker", "name", "label"].includes(key)
    ? "asc"
    : "desc";
}

export function valueForSort(
  row: SoxConstituent,
  key: SortKey
): string | number | null {
  if (key === "ticker") return row.ticker || "";
  if (key === "name") return row.name || "";
  if (key === "label") return row.scores?.label || "";
  if (key in row) return normalizeSortValue(row[key]);
  if (row.scores && key in row.scores) {
    return normalizeSortValue(row.scores[key as keyof typeof row.scores]);
  }
  if (row.metrics && key in row.metrics) {
    return normalizeSortValue(row.metrics[key]);
  }
  return null;
}

function normalizeSortValue(value: unknown): string | number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  return null;
}

export function compareRows(
  left: SoxConstituent,
  right: SoxConstituent,
  key: SortKey,
  direction: SortDirection
): number {
  const modifier = direction === "asc" ? 1 : -1;
  const leftValue = valueForSort(left, key);
  const rightValue = valueForSort(right, key);
  const leftMissing =
    leftValue === null || leftValue === undefined || leftValue === "";
  const rightMissing =
    rightValue === null || rightValue === undefined || rightValue === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (
    typeof leftValue === "string" ||
    typeof rightValue === "string"
  ) {
    return (
      String(leftValue).localeCompare(String(rightValue), "en", {
        numeric: true,
        sensitivity: "base"
      }) * modifier
    );
  }
  return ((leftValue > rightValue ? 1 : 0) -
    (leftValue < rightValue ? 1 : 0)) * modifier;
}

export function rowSearchText(row: SoxConstituent): string {
  const metrics = row.metrics || {};
  const scores = row.scores || {};
  return [
    row.rank,
    row.ticker,
    row.name,
    row.indexName,
    row.proxyWeight,
    row.price,
    row.marketCap,
    metrics.return3m,
    metrics.return12m,
    metrics.quarterlyRevenueYoY,
    metrics.quarterlyEpsYoY,
    metrics.trailingPe,
    scores.priceMomentum,
    scores.earningsMomentum,
    scores.label
  ]
    .join(" ")
    .toLowerCase();
}

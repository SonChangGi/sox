import type {
  SoxAnalysis,
  SoxConstituent,
  SoxHistory
} from "@/types";

export const SOX_STATIC_RESULT_CONTRACT = "sox-static-result/v1" as const;

export interface SoxStaticRawPayloads {
  analysis: unknown;
  history: unknown;
}

export interface SoxStaticResultIdentity {
  projectId: "sox";
  publicSummaryProjectId: "sox";
  contractVersion: typeof SOX_STATIC_RESULT_CONTRACT;
  generatedAt: string;
  dataAsOf: string;
  snapshotCount: number;
  constituentCount: number;
  resultKey: string;
  sourceFiles: readonly [
    "data/sox-analysis.json",
    "data/sox-history.json"
  ];
}

export interface AdaptedSoxStaticResult {
  analysis: SoxAnalysis;
  history: SoxHistory;
  snapshots: SoxAnalysis[];
  identity: SoxStaticResultIdentity;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} 구조가 객체가 아닙니다.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} 문자열이 없습니다.`);
  }
  return value;
}

function requiredInteger(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`${path} 정수가 유효하지 않습니다.`);
  }
  return value;
}

function validateDate(value: unknown, path: string): string {
  const date = requiredString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${path} 날짜 형식이 올바르지 않습니다.`);
  }
  return date;
}

function validateConstituent(
  value: unknown,
  index: number,
  path: string
): asserts value is SoxConstituent {
  const row = record(value, `${path}[${index}]`);
  requiredString(row.ticker, `${path}[${index}].ticker`);
  const scores = record(row.scores, `${path}[${index}].scores`);
  requiredString(scores.label, `${path}[${index}].scores.label`);
  for (const key of [
    "combined",
    "priceMomentum",
    "earningsMomentum"
  ]) {
    const score = scores[key];
    if (
      score !== null &&
      (typeof score !== "number" || !Number.isFinite(score))
    ) {
      throw new Error(`${path}[${index}].scores.${key} 값이 유효하지 않습니다.`);
    }
  }
}

function validateAnalysis(
  value: unknown,
  path: string
): asserts value is SoxAnalysis {
  const payload = record(value, path);
  if (payload.schemaVersion !== 1 || payload.projectId !== "sox") {
    throw new Error(`${path} SOX identity가 올바르지 않습니다.`);
  }
  validateDate(payload.dataAsOf, `${path}.dataAsOf`);
  requiredString(payload.generatedAt, `${path}.generatedAt`);
  if (!Array.isArray(payload.constituents) || !payload.constituents.length) {
    throw new Error(`${path}.constituents 배열이 없습니다.`);
  }
  payload.constituents.forEach((row, index) =>
    validateConstituent(row, index, `${path}.constituents`)
  );
  const leaders = record(payload.leaders, `${path}.leaders`);
  for (const key of [
    "combined",
    "priceMomentum",
    "earningsMomentum",
    "proxyWeight"
  ]) {
    if (!Array.isArray(leaders[key])) {
      throw new Error(`${path}.leaders.${key} 배열이 없습니다.`);
    }
  }
}

/**
 * Validates the existing SOX files as one immutable static-result snapshot.
 * It never recalculates, normalizes, sorts, clones, or replaces result rows.
 */
export function adaptSoxStaticResultV1(
  payloads: SoxStaticRawPayloads
): AdaptedSoxStaticResult {
  validateAnalysis(payloads.analysis, "analysis");
  const historyRecord = record(payloads.history, "history");
  if (
    historyRecord.schemaVersion !== 1 ||
    historyRecord.projectId !== "sox"
  ) {
    throw new Error("history SOX identity가 올바르지 않습니다.");
  }
  const historyGeneratedAt = requiredString(
    historyRecord.generatedAt,
    "history.generatedAt"
  );
  const latestDataAsOf = validateDate(
    historyRecord.latestDataAsOf,
    "history.latestDataAsOf"
  );
  const snapshotCount = requiredInteger(
    historyRecord.snapshotCount,
    "history.snapshotCount"
  );
  if (
    !Array.isArray(historyRecord.snapshots) ||
    historyRecord.snapshots.length !== snapshotCount
  ) {
    throw new Error("history.snapshotCount와 snapshots 길이가 일치하지 않습니다.");
  }
  historyRecord.snapshots.forEach((snapshot, index) =>
    validateAnalysis(snapshot, `history.snapshots[${index}]`)
  );

  const analysis = payloads.analysis;
  const history = payloads.history as SoxHistory;
  if (
    analysis.generatedAt !== historyGeneratedAt ||
    analysis.dataAsOf !== latestDataAsOf
  ) {
    throw new Error("SOX analysis와 history 최신 snapshot identity가 다릅니다.");
  }
  if (
    !history.snapshots.some(
      (snapshot) => snapshot.dataAsOf === analysis.dataAsOf
    )
  ) {
    throw new Error("SOX history에 최신 analysis 기준일이 없습니다.");
  }

  const byDate = new Map<string, SoxAnalysis>();
  for (const snapshot of history.snapshots) {
    if (byDate.has(snapshot.dataAsOf)) {
      throw new Error(`SOX history 기준일이 중복됩니다: ${snapshot.dataAsOf}`);
    }
    byDate.set(snapshot.dataAsOf, snapshot);
  }
  byDate.set(analysis.dataAsOf, analysis);
  const snapshots = [...byDate.values()].sort((left, right) =>
    right.dataAsOf.localeCompare(left.dataAsOf)
  );

  return {
    analysis,
    history,
    snapshots,
    identity: {
      projectId: "sox",
      publicSummaryProjectId: "sox",
      contractVersion: SOX_STATIC_RESULT_CONTRACT,
      generatedAt: analysis.generatedAt,
      dataAsOf: analysis.dataAsOf,
      snapshotCount,
      constituentCount: analysis.constituents.length,
      resultKey: [
        analysis.generatedAt,
        analysis.dataAsOf,
        snapshotCount,
        analysis.constituents.length
      ].join("|"),
      sourceFiles: [
        "data/sox-analysis.json",
        "data/sox-history.json"
      ]
    }
  };
}

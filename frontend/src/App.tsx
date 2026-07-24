import { useEffect, useMemo, useState } from "react";
import { SharedNav } from "@/components/SharedNav";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatScore,
  isFiniteNumber,
  numberClass,
  scoreClass
} from "@/lib/format";
import { loadSoxStaticResult } from "@/lib/data";
import {
  compareRows,
  defaultDirectionFor,
  rowSearchText
} from "@/lib/table";
import { barWidthPercent, layoutQuadrantRows } from "@/lib/charts";
import {
  assertDisplayStatePatch,
  type AdaptedSoxStaticResult
} from "@/shared-platform";
import type {
  SortDirection,
  SortKey,
  SoxAnalysis,
  SoxConstituent,
  SoxLeader
} from "@/types";

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "rank", label: "종합 랭크" },
  { value: "ticker", label: "티커" },
  { value: "name", label: "회사명" },
  { value: "proxyWeight", label: "프록시 비중" },
  { value: "price", label: "현재가" },
  { value: "marketCap", label: "시가총액" },
  { value: "priceMomentum", label: "가격 모멘텀" },
  { value: "earningsMomentum", label: "실적 모멘텀" },
  { value: "return3m", label: "3M 수익률" },
  { value: "return12m", label: "12M 수익률" },
  { value: "quarterlyRevenueYoY", label: "매출 YoY" },
  { value: "quarterlyEpsYoY", label: "EPS YoY" },
  { value: "trailingPe", label: "P/E" },
  { value: "label", label: "Signal" }
];

const tableColumns: Array<{
  key: SortKey;
  label: string;
}> = [
  { key: "rank", label: "Rank" },
  { key: "ticker", label: "Ticker" },
  { key: "name", label: "Name" },
  { key: "proxyWeight", label: "Proxy Wt" },
  { key: "price", label: "Price" },
  { key: "marketCap", label: "Market Cap" },
  { key: "return3m", label: "3M" },
  { key: "return12m", label: "12M" },
  { key: "quarterlyRevenueYoY", label: "Rev YoY" },
  { key: "quarterlyEpsYoY", label: "EPS YoY" },
  { key: "trailingPe", label: "P/E" },
  { key: "priceMomentum", label: "Price Mom" },
  { key: "earningsMomentum", label: "Earn Mom" },
  { key: "label", label: "Signal" }
];

function firstTicker(analysis: SoxAnalysis): string {
  return (
    analysis.leaders?.combined?.[0]?.ticker ||
    analysis.constituents[0]?.ticker ||
    ""
  );
}

function MetricCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="metric-card">
      <p className="eyebrow">{label}</p>
      <div className="value">{value}</div>
      <div className="detail">{detail}</div>
    </article>
  );
}

function StatusChip({
  kind,
  children
}: {
  kind: "ok" | "warning" | "error" | "neutral";
  children: React.ReactNode;
}) {
  return <span className={`status-chip ${kind}`}>{children}</span>;
}

type ChartSelectionHandlers = {
  pinnedTicker: string;
  activeTicker: string;
  onPreview: (ticker: string | null) => void;
  onPin: (ticker: string) => void;
};

function chartSelectionKeyDown(
  event: React.KeyboardEvent<HTMLButtonElement>,
  ticker: string,
  onPin: (ticker: string) => void
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onPin(ticker);
}

function BarChart({
  rows,
  valueKey,
  valueKind,
  color,
  pinnedTicker,
  activeTicker,
  onPreview,
  onPin
}: {
  rows: SoxLeader[];
  valueKey:
    | "proxyWeight"
    | "priceMomentum"
    | "earningsMomentum";
  valueKind: "percent" | "score";
  color?: "green" | "amber";
} & ChartSelectionHandlers) {
  const valid = rows
    .filter((row) => isFiniteNumber(row[valueKey]))
    .slice(0, 8);
  if (!valid.length) {
    return (
      <div className="bar-chart">
        <p className="muted">표시할 데이터가 부족합니다.</p>
      </div>
    );
  }
  const maximum = Math.max(
    ...valid.map((row) => Math.abs(row[valueKey] as number)),
    0.00001
  );
  const activeHere = valid.some((row) => row.ticker === activeTicker);
  return (
    <div className={`bar-chart${activeHere ? " has-active" : ""}`}>
      {valid.map((row) => {
        const rawValue = row[valueKey] as number;
        const width = barWidthPercent(rawValue, maximum);
        const value =
          valueKind === "score"
            ? formatScore(rawValue)
            : formatPercent(rawValue);
        const active = row.ticker === activeTicker;
        const pinned = row.ticker === pinnedTicker;
        return (
          <button
            key={row.ticker}
            className={`bar-row${active ? " is-active" : ""}${
              pinned ? " is-pinned" : ""
            }`}
            type="button"
            aria-pressed={pinned}
            aria-label={`${row.ticker} ${value}`}
            onClick={() => onPin(row.ticker)}
            onFocus={() => onPreview(row.ticker)}
            onBlur={() => onPreview(null)}
            onPointerEnter={() => onPreview(row.ticker)}
            onPointerLeave={() => onPreview(null)}
            onKeyDown={(event) =>
              chartSelectionKeyDown(event, row.ticker, onPin)
            }
          >
            <span className="bar-label">{row.ticker}</span>
            <span className="bar-track">
              <span
                className={`bar-fill${color ? ` ${color}` : ""}`}
                style={{ width: `${width.toFixed(2)}%` }}
              />
            </span>
            <span className="bar-value">{value}</span>
          </button>
        );
      })}
    </div>
  );
}

function Quadrant({
  rows,
  pinnedTicker,
  activeTicker,
  onPreview,
  onPin
}: {
  rows: SoxConstituent[];
} & ChartSelectionHandlers) {
  const valid = [...rows]
    .filter(
      (row) =>
        isFiniteNumber(row.scores?.priceMomentum) &&
        isFiniteNumber(row.scores?.earningsMomentum)
    )
    .sort(
      (left, right) =>
        (right.scores?.combined || 0) - (left.scores?.combined || 0)
    )
    .slice(0, 18);
  const activeHere = valid.some((row) => row.ticker === activeTicker);
  if (!valid.length) {
    return (
      <div className="quadrant">
        <p className="muted">quadrant 데이터를 계산할 수 없습니다.</p>
      </div>
    );
  }
  const positioned = layoutQuadrantRows(valid);
  return (
    <div className={`quadrant${activeHere ? " has-active" : ""}`}>
      <span className="quad-axis y">earnings momentum ↑</span>
      <span className="quad-axis x">price momentum →</span>
      <div className="quadrant-plot">
      {positioned.map(({ row, left, top }) => {
        const priceScore = row.scores!.priceMomentum as number;
        const earningsScore = row.scores!.earningsMomentum as number;
        const active = row.ticker === activeTicker;
        const pinned = row.ticker === pinnedTicker;
        return (
          <button
            key={row.ticker}
            className={`quad-point${active ? " is-active" : ""}${
              pinned ? " is-pinned" : ""
            }`}
            type="button"
            aria-pressed={pinned}
            aria-label={`${row.ticker} · 가격 ${formatScore(
              priceScore
            )} · 실적 ${formatScore(earningsScore)} · ${
              row.scores?.label || ""
            }`}
            style={{ left: `${left.toFixed(2)}%`, top: `${top.toFixed(2)}%` }}
            onClick={() => onPin(row.ticker)}
            onFocus={() => onPreview(row.ticker)}
            onBlur={() => onPreview(null)}
            onPointerEnter={() => onPreview(row.ticker)}
            onPointerLeave={() => onPreview(null)}
            onKeyDown={(event) =>
              chartSelectionKeyDown(event, row.ticker, onPin)
            }
          >
            {row.ticker}
          </button>
        );
      })}
      </div>
    </div>
  );
}

function ChartReadout({
  row
}: {
  row: SoxConstituent | undefined;
}) {
  if (!row) return null;
  return (
    <div className="chart-readout" aria-live="polite">
      <strong>
        {row.ticker} <span>{row.name || ""}</span>
      </strong>
      <dl>
        <div>
          <dt>프록시 비중</dt>
          <dd>{formatPercent(row.proxyWeight)}</dd>
        </div>
        <div>
          <dt>가격 점수</dt>
          <dd>{formatScore(row.scores?.priceMomentum)}</dd>
        </div>
        <div>
          <dt>실적 점수</dt>
          <dd>{formatScore(row.scores?.earningsMomentum)}</dd>
        </div>
        <div>
          <dt>종합 점수</dt>
          <dd>{formatScore(row.scores?.combined)}</dd>
        </div>
        <div>
          <dt>신호</dt>
          <dd>{row.scores?.label || "-"}</dd>
        </div>
      </dl>
    </div>
  );
}

function LeaderCard({
  title,
  rows,
  valueKey
}: {
  title: string;
  rows: SoxLeader[];
  valueKey:
    | "combined"
    | "priceMomentum"
    | "earningsMomentum"
    | "proxyWeight";
}) {
  return (
    <article className="leader-card">
      <p className="eyebrow">{valueKey}</p>
      <h3>{title}</h3>
      <div className="leader-list">
        {rows.length ? (
          rows.slice(0, 5).map((row) => {
            const rawValue =
              valueKey === "proxyWeight"
                ? row.proxyWeight
                : row[valueKey];
            const displayValue =
              valueKey === "proxyWeight"
                ? formatPercent(rawValue)
                : formatScore(rawValue);
            const scoreValue =
              valueKey === "proxyWeight" && isFiniteNumber(rawValue)
                ? rawValue * 3
                : rawValue;
            return (
              <div className="leader-item" key={row.ticker}>
                <strong>{row.ticker || "-"}</strong>
                <span>
                  {row.name || ""}
                  <small>{row.label || ""}</small>
                </span>
                <span className={`score-pill ${scoreClass(scoreValue)}`}>
                  {displayValue}
                </span>
              </div>
            );
          })
        ) : (
          <p className="muted">데이터 없음</p>
        )}
      </div>
    </article>
  );
}

function ConstituentsTable({
  rows,
  selectedTicker,
  pinnedTicker,
  sortKey,
  sortDirection,
  onSelectTicker,
  onSort
}: {
  rows: SoxConstituent[];
  selectedTicker: string;
  pinnedTicker: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSelectTicker: (ticker: string) => void;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div
      className="table-wrap"
      role="region"
      aria-label="SOX 구성종목 상세 테이블"
      tabIndex={0}
    >
      <table id="constituent-table">
        <caption>
          SOX 구성종목 프록시 비중, 가격 모멘텀, 실적 모멘텀, 재무 지표
        </caption>
        <thead>
          <tr>
            {tableColumns.map((column) => {
              const active = column.key === sortKey;
              return (
                <th
                  key={column.key}
                  aria-sort={
                    active
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                  >
                    {column.label}{" "}
                    <span className="sort-indicator" aria-hidden="true">
                      {active ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => {
              const metrics = row.metrics || {};
              const scores = row.scores || {};
              const selected = row.ticker === selectedTicker;
              const pinned = row.ticker === pinnedTicker;
              return (
                <tr
                  key={row.ticker}
                  className={selected ? "is-selected" : undefined}
                >
                  <td>
                    {formatNumber(row.rank, { maximumFractionDigits: 0 })}
                  </td>
                  <td>
                    <button
                      className="ticker-select"
                      type="button"
                      aria-pressed={pinned}
                      onClick={() => onSelectTicker(row.ticker)}
                    >
                      {row.ticker}
                    </button>
                  </td>
                  <td className="name-cell" title={row.name || ""}>
                    {row.name || ""}
                  </td>
                  <td>{formatPercent(row.proxyWeight)}</td>
                  <td>{formatCurrency(row.price)}</td>
                  <td>{formatCompact(row.marketCap)}</td>
                  <td className={numberClass(metrics.return3m)}>
                    {formatPercent(metrics.return3m)}
                  </td>
                  <td className={numberClass(metrics.return12m)}>
                    {formatPercent(metrics.return12m)}
                  </td>
                  <td className={numberClass(metrics.quarterlyRevenueYoY)}>
                    {formatPercent(metrics.quarterlyRevenueYoY)}
                  </td>
                  <td className={numberClass(metrics.quarterlyEpsYoY)}>
                    {formatPercent(metrics.quarterlyEpsYoY)}
                  </td>
                  <td>
                    {formatNumber(metrics.trailingPe, {
                      maximumFractionDigits: 1
                    })}
                  </td>
                  <td>
                    <span
                      className={`score-pill ${scoreClass(
                        scores.priceMomentum
                      )}`}
                    >
                      {formatScore(scores.priceMomentum)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`score-pill ${scoreClass(
                        scores.earningsMomentum
                      )}`}
                    >
                      {formatScore(scores.earningsMomentum)}
                    </span>
                  </td>
                  <td>
                    <span className="signal-pill">
                      {scores.label || "-"}
                    </span>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={14}>검색 결과가 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({
  result
}: {
  result: AdaptedSoxStaticResult;
}) {
  const requestedDate = new URLSearchParams(window.location.search).get(
    "date"
  );
  const initialAnalysis =
    result.snapshots.find(
      (snapshot) => snapshot.dataAsOf === requestedDate
    ) || result.analysis;
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [pinnedTicker, setPinnedTicker] = useState(
    firstTicker(initialAnalysis)
  );
  const [previewTicker, setPreviewTicker] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("asc");

  const activeTicker = previewTicker || pinnedTicker;
  const selectedRow = analysis.constituents.find(
    (row) => row.ticker === activeTicker
  );
  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return analysis.constituents
      .filter((row) => !query || rowSearchText(row).includes(query))
      .slice()
      .sort((left, right) =>
        compareRows(left, right, sortKey, sortDirection)
      );
  }, [analysis, searchQuery, sortDirection, sortKey]);

  function selectSnapshot(date: string) {
    assertDisplayStatePatch({ snapshotDate: date });
    const next =
      result.snapshots.find((snapshot) => snapshot.dataAsOf === date) ||
      result.analysis;
    setAnalysis(next);
    setPreviewTicker(null);
    if (!next.constituents.some((row) => row.ticker === pinnedTicker)) {
      setPinnedTicker(firstTicker(next));
    }
    const url = new URL(window.location.href);
    url.searchParams.set("date", next.dataAsOf);
    window.history.replaceState({}, "", url);
  }

  function pinTicker(ticker: string) {
    assertDisplayStatePatch({ selectedTicker: ticker });
    setPinnedTicker(ticker);
    setPreviewTicker(null);
  }

  function changeSort(key: SortKey) {
    const direction =
      key === sortKey
        ? sortDirection === "asc"
          ? "desc"
          : "asc"
        : defaultDirectionFor(key);
    assertDisplayStatePatch({ sortKey: key, sortDirection: direction });
    setSortKey(key);
    setSortDirection(direction);
  }

  const status = analysis.status || {};
  const coverage = analysis.coverage || {};
  const isOk = status.level === "ok";
  const topCombined = analysis.leaders.combined?.[0];
  const topWeight = analysis.leaders.proxyWeight?.[0];
  const topPrice = analysis.leaders.priceMomentum?.[0];
  const topEarnings = analysis.leaders.earningsMomentum?.[0];
  const sourceRecords = Object.values(analysis.sources || {});

  return (
    <div id="top">
      <a className="skip-link" href="#main-content">
        본문 바로가기
      </a>
      <SharedNav />
      <header className="hero" aria-labelledby="page-title">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">SOX Semiconductor Index</p>
            <h1 id="page-title">SOX 반도체 리서치</h1>
            <div className="hero-actions" aria-label="주요 섹션 바로가기">
              <a href="#charts">핵심 차트</a>
              <a href="#constituents">전체 종목</a>
            </div>
          </div>
          <aside className="hero-note" aria-labelledby="snapshot-panel-title">
            <p className="eyebrow">Data as of</p>
            <h2 id="snapshot-panel-title">조회 기준일</h2>
            <div className="snapshot-control">
              <label htmlFor="snapshot-date-select">저장 기준일 선택</label>
              <select
                id="snapshot-date-select"
                value={analysis.dataAsOf}
                disabled={result.snapshots.length <= 1}
                onChange={(event) => selectSnapshot(event.target.value)}
              >
                {result.snapshots.map((snapshot) => (
                  <option
                    key={snapshot.dataAsOf}
                    value={snapshot.dataAsOf}
                  >
                    {formatDate(snapshot.dataAsOf)}
                    {snapshot.dataAsOf === result.analysis.dataAsOf
                      ? " · latest"
                      : ""}
                  </option>
                ))}
              </select>
              <p className="snapshot-summary">
                선택 {formatDate(analysis.dataAsOf)} ·{" "}
                {result.snapshots.length}개 저장 · 최신{" "}
                {formatDate(result.analysis.dataAsOf)}
              </p>
            </div>
            <div className="status-stack" aria-live="polite">
              <StatusChip kind={isOk ? "ok" : "warning"}>
                {isOk
                  ? "데이터 정상"
                  : `데이터 ${status.level || "확인 필요"}`}
              </StatusChip>
              <StatusChip
                kind={
                  (coverage.fundamentals?.ratio || 0) > 0.7
                    ? "ok"
                    : "warning"
                }
              >
                재무 {formatPercent(coverage.fundamentals?.ratio)}
              </StatusChip>
              <StatusChip kind="neutral">
                {analysis.index?.weightMethod === "official"
                  ? "공식 비중"
                  : "프록시 비중"}
              </StatusChip>
            </div>
            {!isOk && (
              <p className="status-message">
                {status.message || "일부 데이터를 확인할 수 없습니다."}
              </p>
            )}
          </aside>
        </div>
      </header>

      <main id="main-content">
        <section
          className="section cockpit-section"
          aria-labelledby="cockpit-title"
        >
          <div className="section-heading">
            <p className="eyebrow">Research Cockpit</p>
            <h2 id="cockpit-title">핵심 결과</h2>
          </div>
          <div className="metric-grid" aria-live="polite">
            <MetricCard
              label="구성종목"
              value={formatNumber(analysis.index?.constituentCount, {
                maximumFractionDigits: 0
              })}
              detail={`구성 기준 ${
                analysis.index?.constituentSource?.tradeDate || "-"
              }`}
            />
            <MetricCard
              label="최대 프록시 비중"
              value={topWeight?.ticker || "-"}
              detail={`${formatPercent(topWeight?.proxyWeight)} · ${
                topWeight?.name || ""
              }`}
            />
            <MetricCard
              label="종합 1위"
              value={topCombined?.ticker || "-"}
              detail={`${formatScore(topCombined?.combined)} · ${
                topCombined?.label || ""
              }`}
            />
            <MetricCard
              label="데이터 커버리지"
              value={`${coverage.price?.count || 0}/${
                analysis.index?.constituentCount || 0
              }`}
              detail={`가격 · 재무 ${formatPercent(
                coverage.fundamentals?.ratio
              )}`}
            />
            <MetricCard
              label="가격 1위"
              value={topPrice?.ticker || "-"}
              detail={`${formatScore(topPrice?.priceMomentum)} · 3M ${formatPercent(
                topPrice?.return3m
              )}`}
            />
            <MetricCard
              label="실적 1위"
              value={topEarnings?.ticker || "-"}
              detail={`${formatScore(
                topEarnings?.earningsMomentum
              )} · 매출 YoY ${formatPercent(
                topEarnings?.quarterlyRevenueYoY
              )}`}
            />
          </div>
        </section>

        <section className="section" id="charts" aria-labelledby="charts-title">
          <div className="section-heading">
            <p className="eyebrow">Charts</p>
            <h2 id="charts-title">비중·모멘텀 시각화</h2>
          </div>
          <ChartReadout row={selectedRow} />
          <div className="chart-grid">
            <article className="panel" aria-labelledby="weight-chart-title">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">Proxy Weight</p>
                  <h3 id="weight-chart-title">상위 프록시 비중</h3>
                </div>
              </div>
              <BarChart
                rows={analysis.leaders.proxyWeight || []}
                valueKey="proxyWeight"
                valueKind="percent"
                pinnedTicker={pinnedTicker}
                activeTicker={activeTicker}
                onPreview={setPreviewTicker}
                onPin={pinTicker}
              />
            </article>
            <article className="panel" aria-labelledby="price-chart-title">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">Price Momentum</p>
                  <h3 id="price-chart-title">가격 모멘텀 리더</h3>
                </div>
              </div>
              <BarChart
                rows={analysis.leaders.priceMomentum || []}
                valueKey="priceMomentum"
                valueKind="score"
                color="green"
                pinnedTicker={pinnedTicker}
                activeTicker={activeTicker}
                onPreview={setPreviewTicker}
                onPin={pinTicker}
              />
            </article>
            <article className="panel" aria-labelledby="earnings-chart-title">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">Earnings Momentum</p>
                  <h3 id="earnings-chart-title">실적 모멘텀 리더</h3>
                </div>
              </div>
              <BarChart
                rows={analysis.leaders.earningsMomentum || []}
                valueKey="earningsMomentum"
                valueKind="score"
                color="amber"
                pinnedTicker={pinnedTicker}
                activeTicker={activeTicker}
                onPreview={setPreviewTicker}
                onPin={pinTicker}
              />
            </article>
            <article className="panel" aria-labelledby="quadrant-title">
              <div className="panel-header compact">
                <div>
                  <p className="eyebrow">Quadrant</p>
                  <h3 id="quadrant-title">가격 vs 실적</h3>
                </div>
              </div>
              <Quadrant
                rows={analysis.constituents}
                pinnedTicker={pinnedTicker}
                activeTicker={activeTicker}
                onPreview={setPreviewTicker}
                onPin={pinTicker}
              />
            </article>
          </div>
        </section>

        <section
          className="section"
          id="momentum"
          aria-labelledby="momentum-title"
        >
          <div className="section-heading">
            <p className="eyebrow">Momentum Dossier</p>
            <h2 id="momentum-title">가격·실적 모멘텀 상위 종목</h2>
          </div>
          <div className="leader-grid" aria-live="polite">
            <LeaderCard
              title="종합 랭킹"
              rows={analysis.leaders.combined || []}
              valueKey="combined"
            />
            <LeaderCard
              title="가격 모멘텀"
              rows={analysis.leaders.priceMomentum || []}
              valueKey="priceMomentum"
            />
            <LeaderCard
              title="실적 모멘텀"
              rows={analysis.leaders.earningsMomentum || []}
              valueKey="earningsMomentum"
            />
            <LeaderCard
              title="프록시 비중"
              rows={analysis.leaders.proxyWeight || []}
              valueKey="proxyWeight"
            />
          </div>
        </section>

        <section
          className="section"
          id="constituents"
          aria-labelledby="constituents-title"
        >
          <div className="section-heading split-heading">
            <div>
              <p className="eyebrow">Constituents</p>
              <h2 id="constituents-title">SOX 구성종목 테이블</h2>
            </div>
            <div className="table-tools">
              <label htmlFor="search-input">검색</label>
              <input
                id="search-input"
                type="search"
                value={searchQuery}
                placeholder="NVDA, AMD, revenue..."
                autoComplete="off"
                onChange={(event) => {
                  assertDisplayStatePatch({
                    searchQuery: event.target.value
                  });
                  setSearchQuery(event.target.value);
                }}
              />
              <label htmlFor="sort-select">정렬</label>
              <select
                id="sort-select"
                value={sortKey}
                onChange={(event) =>
                  changeSort(event.target.value as SortKey)
                }
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label htmlFor="sort-direction">방향</label>
              <select
                id="sort-direction"
                value={sortDirection}
                aria-label="정렬 방향"
                onChange={(event) => {
                  const nextDirection =
                    event.target.value === "desc" ? "desc" : "asc";
                  assertDisplayStatePatch({
                    sortDirection: nextDirection
                  });
                  setSortDirection(nextDirection);
                }}
              >
                <option value="asc">오름차순</option>
                <option value="desc">내림차순</option>
              </select>
            </div>
          </div>
          <ConstituentsTable
            rows={visibleRows}
            selectedTicker={activeTicker}
            pinnedTicker={pinnedTicker}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSelectTicker={pinTicker}
            onSort={changeSort}
          />
        </section>

        <section
          className="section methodology-section"
          id="methodology"
          aria-label="데이터와 운영 상세"
        >
          <details className="ops-details">
            <summary>
              <span>데이터 · 출처 · 운영 상세</span>
            </summary>
            <div className="method-grid">
              <article>
                <h3>데이터 기준</h3>
                <dl className="ops-list">
                  <div>
                    <dt>선택 기준일</dt>
                    <dd>{formatDate(analysis.dataAsOf)}</dd>
                  </div>
                  <div>
                    <dt>생성 시각</dt>
                    <dd>{formatDateTime(analysis.generatedAt)}</dd>
                  </div>
                  <div>
                    <dt>비중 방식</dt>
                    <dd>{analysis.index?.weightMethodLabel || "-"}</dd>
                  </div>
                  <div>
                    <dt>데이터 상태</dt>
                    <dd>
                      {status.level || "unknown"} · {status.message || "-"}
                    </dd>
                  </div>
                </dl>
                <p>
                  {analysis.methodology?.weightCaveat ||
                    "공식 무료 비중이 없을 경우 시가총액을 정규화한 프록시 비중을 사용합니다."}
                </p>
                {status.publicPagesReadback && (
                  <p className="ops-meta">{status.publicPagesReadback}</p>
                )}
              </article>
              <article>
                <h3>출처</h3>
                <ul>
                  {sourceRecords.map((source) => (
                    <li key={`${source.name}-${source.url}`}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.name}
                      </a>
                      : {source.usage}
                    </li>
                  ))}
                </ul>
              </article>
              <article>
                <h3>운영 상세</h3>
                <p>
                  개인 리서치용이며 투자 조언이 아닙니다. 데이터는 지연되거나
                  일부 누락될 수 있습니다.
                </p>
              </article>
            </div>
          </details>
        </section>
      </main>

      <footer className="site-footer">
        <p>
          SOX Research Cockpit ·{" "}
          <a href="https://sonchanggi.github.io/quant-dashboard/">
            Quant Research Hub
          </a>
        </p>
      </footer>
      <nav className="page-jump-nav" aria-label="페이지 빠른 이동">
        <a href="#top" aria-label="맨 위로 이동" title="맨 위로">
          ↑
        </a>
        <a href="#page-bottom" aria-label="맨 아래로 이동" title="맨 아래로">
          ↓
        </a>
      </nav>
      <div id="page-bottom" tabIndex={-1} aria-hidden="true" />
    </div>
  );
}

export function App() {
  const [result, setResult] = useState<AdaptedSoxStaticResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadSoxStaticResult()
      .then((loaded) => {
        if (active) setResult(loaded);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : String(reason)
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <>
        <a className="skip-link" href="#main-content">
          본문 바로가기
        </a>
        <SharedNav />
        <main className="load-state" id="main-content" tabIndex={-1}>
          <h1>데이터를 표시하지 못했습니다</h1>
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        </main>
      </>
    );
  }

  if (!result) {
    return (
      <>
        <a className="skip-link" href="#main-content">
          본문 바로가기
        </a>
        <SharedNav />
        <main
          className="load-state"
          id="main-content"
          tabIndex={-1}
          aria-live="polite"
        >
          <p className="eyebrow">SOX Semiconductor Index</p>
          <h1>SOX 리서치를 불러오는 중</h1>
        </main>
      </>
    );
  }

  return <Dashboard result={result} />;
}

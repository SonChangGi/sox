(() => {
  'use strict';

  const DATA_URL = 'data/sox-analysis.json';
  const HISTORY_URL = 'data/sox-history.json';
  const THEME_STORAGE_KEY = 'quant-research-theme';
  const LEGACY_THEME_STORAGE_KEY = 'sox-theme';
  const state = {
    analysis: null,
    latestAnalysis: null,
    history: null,
    snapshots: [],
    selectedDate: '',
    pinnedTicker: '',
    previewTicker: '',
    rows: [],
    filteredRows: [],
    sortKey: 'rank',
    sortDirection: 'asc',
  };

  const els = {
    sourceStatus: document.querySelector('#source-status'),
    metricGrid: document.querySelector('#metric-grid'),
    weightChart: document.querySelector('#weight-chart'),
    priceChart: document.querySelector('#price-chart'),
    earningsChart: document.querySelector('#earnings-chart'),
    quadrantChart: document.querySelector('#quadrant-chart'),
    chartSelection: document.querySelector('#chart-selection'),
    leaderGrid: document.querySelector('#leader-grid'),
    searchInput: document.querySelector('#search-input'),
    sortSelect: document.querySelector('#sort-select'),
    sortDirection: document.querySelector('#sort-direction'),
    snapshotDate: document.querySelector('#snapshot-date-select'),
    snapshotSummary: document.querySelector('#snapshot-summary'),
    statusMessage: document.querySelector('#status-message'),
    table: document.querySelector('#constituent-table'),
    tableBody: document.querySelector('#constituent-body'),
    sourceList: document.querySelector('#source-list'),
    weightCaveat: document.querySelector('#weight-caveat'),
    opsSelectedDate: document.querySelector('#ops-selected-date'),
    opsGeneratedAt: document.querySelector('#ops-generated-at'),
    opsWeightMethod: document.querySelector('#ops-weight-method'),
    opsDataStatus: document.querySelector('#ops-data-status'),
    opsPublicReadback: document.querySelector('#ops-public-readback'),
    themeToggle: document.querySelector('#theme-toggle'),
    themeToggleText: document.querySelector('.theme-toggle-text'),
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    initTheme();
    bindControls();
    try {
      const [analysis, history] = await Promise.all([
        fetchJson(DATA_URL),
        fetchOptionalJson(HISTORY_URL),
      ]);
      state.latestAnalysis = analysis;
      state.history = history;
      state.snapshots = normalizeSnapshots(analysis, history);
      const requestedDate = new URLSearchParams(window.location.search).get('date');
      const selected = state.snapshots.find((snapshot) => snapshot.dataAsOf === requestedDate) || state.snapshots[0] || analysis;
      applySnapshot(selected?.dataAsOf || analysis.dataAsOf, { updateUrl: false });
    } catch (error) {
      renderError(error);
    }
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return response.json();
  }

  async function fetchOptionalJson(url) {
    try {
      return await fetchJson(url);
    } catch (error) {
      console.warn(`optional history load failed: ${error.message}`);
      return null;
    }
  }

  function bindControls() {
    els.themeToggle?.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme, { persist: true });
    });
    els.searchInput?.addEventListener('input', updateTable);
    els.sortSelect?.addEventListener('change', () => {
      state.sortKey = els.sortSelect.value;
      state.sortDirection = defaultDirectionFor(state.sortKey);
      syncSortControls();
      updateTable();
    });
    els.sortDirection?.addEventListener('change', () => {
      state.sortDirection = els.sortDirection.value === 'desc' ? 'desc' : 'asc';
      updateTable();
    });
    els.table?.querySelectorAll('[data-sort-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-sort-key') || 'rank';
        if (state.sortKey === key) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDirection = defaultDirectionFor(key);
        }
        syncSortControls();
        updateTable();
      });
    });
    els.snapshotDate?.addEventListener('change', () => {
      applySnapshot(els.snapshotDate.value, { updateUrl: true });
    });
    els.tableBody?.addEventListener('click', (event) => {
      const ticker = event.target.closest?.('[data-table-ticker]')?.getAttribute('data-table-ticker');
      if (!ticker) return;
      state.pinnedTicker = ticker;
      state.previewTicker = '';
      syncChartSelection();
    });
    document.querySelector('#charts')?.addEventListener('click', handleChartSelection);
    document.querySelector('#charts')?.addEventListener('focusin', handleChartSelection);
    document.querySelector('#charts')?.addEventListener('pointerover', handleChartSelection);
    document.querySelector('#charts')?.addEventListener('focusout', handleChartPreviewEnd);
    document.querySelector('#charts')?.addEventListener('pointerout', handleChartPreviewEnd);
    document.querySelector('#charts')?.addEventListener('keydown', handleChartKeyDown);
  }

  function initTheme() {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    const theme = storedTheme === 'dark' ? 'dark' : 'light';
    if (!localStorage.getItem(THEME_STORAGE_KEY) && storedTheme) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
    setTheme(theme, { persist: false });
  }

  function setTheme(theme, options = {}) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    if (options.persist) localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    const isDark = nextTheme === 'dark';
    if (els.themeToggle) {
      els.themeToggle.setAttribute('aria-pressed', String(isDark));
      els.themeToggle.setAttribute('aria-label', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
    }
    if (els.themeToggleText) els.themeToggleText.textContent = isDark ? '라이트 모드' : '다크 모드';
  }

  function renderAll() {
    renderSnapshotControls();
    renderStatus();
    renderMetrics();
    renderCharts();
    renderLeaders();
    renderMethodology();
    updateTable();
  }

  function normalizeSnapshots(latest, history) {
    const byDate = new Map();
    const historySnapshots = Array.isArray(history?.snapshots) ? history.snapshots : [];
    for (const snapshot of historySnapshots) {
      if (snapshot && snapshot.dataAsOf) byDate.set(String(snapshot.dataAsOf), snapshot);
    }
    if (latest?.dataAsOf) byDate.set(String(latest.dataAsOf), { ...latest, isLatestSnapshot: true });
    return [...byDate.values()]
      .filter((snapshot) => snapshot && snapshot.dataAsOf)
      .sort((a, b) => String(b.dataAsOf).localeCompare(String(a.dataAsOf)));
  }

  function applySnapshot(date, options = {}) {
    const snapshot = state.snapshots.find((item) => item.dataAsOf === date) || state.latestAnalysis;
    if (!snapshot) return;
    state.analysis = snapshot;
    state.selectedDate = snapshot.dataAsOf || '';
    state.rows = Array.isArray(snapshot.constituents) ? snapshot.constituents : [];
    state.filteredRows = [...state.rows];
    state.previewTicker = '';
    const selectedStillExists = state.rows.some((row) => row.ticker === state.pinnedTicker);
    if (!selectedStillExists) {
      state.pinnedTicker = snapshot.leaders?.combined?.[0]?.ticker || state.rows[0]?.ticker || '';
    }
    if (options.updateUrl && state.selectedDate) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('date', state.selectedDate);
      window.history.replaceState({}, '', nextUrl);
    }
    renderAll();
  }

  function renderSnapshotControls() {
    if (!els.snapshotDate) return;
    const snapshots = state.snapshots || [];
    els.snapshotDate.disabled = snapshots.length <= 1;
    els.snapshotDate.innerHTML = snapshots.map((snapshot) => {
      const latestLabel = snapshot.dataAsOf === state.latestAnalysis?.dataAsOf ? ' · latest' : '';
      return `<option value="${escapeAttr(snapshot.dataAsOf)}">${escapeHtml(formatDate(snapshot.dataAsOf))}${latestLabel}</option>`;
    }).join('');
    if (state.selectedDate) els.snapshotDate.value = state.selectedDate;
    if (els.snapshotSummary) {
      const count = snapshots.length;
      const latest = state.latestAnalysis?.dataAsOf ? `최신 ${formatDate(state.latestAnalysis.dataAsOf)}` : '최신 기준일 확인 중';
      els.snapshotSummary.textContent = `선택 ${formatDate(state.selectedDate)} · ${count}개 저장 · ${latest}`;
    }
  }

  function renderStatus() {
    const analysis = state.analysis;
    const status = analysis.status || {};
    const coverage = analysis.coverage || {};
    const isOk = status.level === 'ok';
    const chips = [
      chip(isOk ? 'ok' : 'warning', isOk ? '데이터 정상' : `데이터 ${status.level || '확인 필요'}`),
      chip(coverage.fundamentals?.ratio > 0.7 ? 'ok' : 'warning', `재무 ${formatPercent(coverage.fundamentals?.ratio)}`),
      chip('neutral', analysis.index?.weightMethod === 'official' ? '공식 비중' : '프록시 비중'),
    ];
    els.sourceStatus.innerHTML = chips.join('');
    if (els.statusMessage) {
      const warningMessage = isOk ? '' : status.message || '일부 데이터를 확인할 수 없습니다.';
      els.statusMessage.textContent = warningMessage;
      els.statusMessage.hidden = !warningMessage;
    }
  }

  function renderMetrics() {
    const analysis = state.analysis;
    const leaders = analysis.leaders || {};
    const topCombined = leaders.combined?.[0];
    const topWeight = leaders.proxyWeight?.[0];
    const topPrice = leaders.priceMomentum?.[0];
    const topEarnings = leaders.earningsMomentum?.[0];
    const cards = [
      metricCard('구성종목', formatNumber(analysis.index?.constituentCount, { maximumFractionDigits: 0 }), `구성 기준 ${analysis.index?.constituentSource?.tradeDate || '-'}`),
      metricCard('최대 프록시 비중', topWeight?.ticker || '-', `${formatPercent(topWeight?.proxyWeight)} · ${topWeight?.name || ''}`),
      metricCard('종합 1위', topCombined?.ticker || '-', `${formatScore(topCombined?.combined)} · ${topCombined?.label || ''}`),
      metricCard('데이터 커버리지', `${analysis.coverage?.price?.count || 0}/${analysis.index?.constituentCount || 0}`, `가격 · 재무 ${formatPercent(analysis.coverage?.fundamentals?.ratio)}`),
      metricCard('가격 1위', topPrice?.ticker || '-', `${formatScore(topPrice?.priceMomentum)} · 3M ${formatPercent(topPrice?.return3m)}`),
      metricCard('실적 1위', topEarnings?.ticker || '-', `${formatScore(topEarnings?.earningsMomentum)} · 매출 YoY ${formatPercent(topEarnings?.quarterlyRevenueYoY)}`),
    ];
    els.metricGrid.innerHTML = cards.join('');
  }

  function renderCharts() {
    const leaders = state.analysis.leaders || {};
    renderBarChart(els.weightChart, leaders.proxyWeight || [], 'proxyWeight', { kind: 'percent', color: '' });
    renderBarChart(els.priceChart, leaders.priceMomentum || [], 'priceMomentum', { kind: 'score', color: 'green' });
    renderBarChart(els.earningsChart, leaders.earningsMomentum || [], 'earningsMomentum', { kind: 'score', color: 'amber' });
    renderQuadrant();
    syncChartSelection();
  }

  function renderBarChart(target, rows, key, options = {}) {
    if (!target) return;
    const valid = rows.filter((row) => isFiniteNumber(row[key])).slice(0, 8);
    if (!valid.length) {
      target.classList.remove('skeleton-box');
      target.innerHTML = '<p class="muted">표시할 데이터가 부족합니다.</p>';
      return;
    }
    const max = Math.max(...valid.map((row) => Math.abs(row[key]) || 0), 0.00001);
    target.classList.remove('skeleton-box');
    target.innerHTML = valid.map((row) => {
      const width = row[key] === 0 ? 0 : Math.abs(row[key]) / max * 100;
      const value = options.kind === 'score' ? formatScore(row[key]) : formatPercent(row[key]);
      const active = row.ticker === activeTicker();
      const pinned = row.ticker === state.pinnedTicker;
      return `<button class="bar-row${active ? ' is-active' : ''}${pinned ? ' is-pinned' : ''}" type="button" data-chart-ticker="${escapeAttr(row.ticker)}" aria-pressed="${pinned}" aria-label="${escapeAttr(`${row.ticker} ${value}`)}">
        <span class="bar-label">${escapeHtml(row.ticker)}</span>
        <span class="bar-track"><span class="bar-fill ${options.color || ''}" style="width:${width.toFixed(2)}%"></span></span>
        <span class="bar-value">${value}</span>
      </button>`;
    }).join('');
  }

  function layoutQuadrantRows(rows) {
    const model = { width: 240, height: 190 };
    const minimumDistance = 38;
    const offsets = [];
    for (let yIndex = -5; yIndex <= 5; yIndex += 1) {
      for (let xIndex = -5; xIndex <= 5; xIndex += 1) {
        offsets.push({ x: xIndex * minimumDistance, y: yIndex * minimumDistance });
      }
    }
    offsets.sort((left, right) => Math.hypot(left.x, left.y) - Math.hypot(right.x, right.y) || left.y - right.y || left.x - right.x);
    const occupied = [];
    return rows.map((row) => {
      const baseX = clamp(row.scores.priceMomentum, 0, 1) * model.width;
      const baseY = (1 - clamp(row.scores.earningsMomentum, 0, 1)) * model.height;
      const position = offsets
        .map((offset) => ({
          x: clamp(baseX + offset.x, 0, model.width),
          y: clamp(baseY + offset.y, 0, model.height),
        }))
        .find((candidate) => occupied.every((point) =>
          Math.abs(candidate.x - point.x) >= minimumDistance
          || Math.abs(candidate.y - point.y) >= minimumDistance))
        || { x: baseX, y: baseY };
      occupied.push(position);
      return {
        row,
        left: position.x / model.width * 100,
        top: position.y / model.height * 100,
      };
    });
  }

  function renderQuadrant() {
    const target = els.quadrantChart;
    if (!target) return;
    const rows = [...state.rows]
      .filter((row) => isFiniteNumber(row.scores?.priceMomentum) && isFiniteNumber(row.scores?.earningsMomentum))
      .sort((a, b) => (b.scores?.combined || 0) - (a.scores?.combined || 0))
      .slice(0, 18);
    target.classList.remove('skeleton-box');
    if (!rows.length) {
      target.innerHTML = '<p class="muted">quadrant 데이터를 계산할 수 없습니다.</p>';
      return;
    }
    const positioned = layoutQuadrantRows(rows);
    target.innerHTML = '<span class="quad-axis y">earnings momentum ↑</span><span class="quad-axis x">price momentum →</span><div class="quadrant-plot">' + positioned.map(({ row, left, top }) => {
      const active = row.ticker === activeTicker();
      const pinned = row.ticker === state.pinnedTicker;
      return `<button class="quad-point${active ? ' is-active' : ''}${pinned ? ' is-pinned' : ''}" type="button" data-chart-ticker="${escapeAttr(row.ticker)}" aria-pressed="${pinned}" aria-label="${escapeAttr(`${row.ticker} · 가격 ${formatScore(row.scores.priceMomentum)} · 실적 ${formatScore(row.scores.earningsMomentum)} · ${row.scores.label || ''}`)}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%">${escapeHtml(row.ticker)}</button>`;
    }).join('') + '</div>';
  }

  function handleChartSelection(event) {
    const target = event.target.closest?.('[data-chart-ticker]');
    if (!target) return;
    const ticker = target.getAttribute('data-chart-ticker');
    if (!ticker) return;
    if (event.type === 'click') {
      state.pinnedTicker = ticker;
      state.previewTicker = '';
    } else {
      state.previewTicker = ticker;
    }
    syncChartSelection();
  }

  function handleChartPreviewEnd(event) {
    const target = event.target.closest?.('[data-chart-ticker]');
    if (!target || target.contains(event.relatedTarget)) return;
    state.previewTicker = '';
    syncChartSelection();
  }

  function handleChartKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest?.('[data-chart-ticker]');
    const ticker = target?.getAttribute('data-chart-ticker');
    if (!ticker) return;
    event.preventDefault();
    state.pinnedTicker = ticker;
    state.previewTicker = '';
    syncChartSelection();
  }

  function activeTicker() {
    return state.previewTicker || state.pinnedTicker;
  }

  function syncChartSelection() {
    const active = activeTicker();
    document.querySelectorAll('[data-chart-ticker]').forEach((element) => {
      const ticker = element.getAttribute('data-chart-ticker');
      const selected = ticker === active;
      const pinned = ticker === state.pinnedTicker;
      element.classList.toggle('is-active', selected);
      element.classList.toggle('is-pinned', pinned);
      element.setAttribute('aria-pressed', String(pinned));
    });
    [els.weightChart, els.priceChart, els.earningsChart, els.quadrantChart].forEach((chart) => {
      chart?.classList.toggle('has-active', Boolean(chart.querySelector('.is-active')));
    });
    els.tableBody?.querySelectorAll('tr').forEach((row) => {
      const ticker = row.querySelector('[data-table-ticker]')?.getAttribute('data-table-ticker');
      row.classList.toggle('is-selected', ticker === active);
      const button = row.querySelector('[data-table-ticker]');
      if (button) button.setAttribute('aria-pressed', String(ticker === state.pinnedTicker));
    });
    if (!els.chartSelection) return;
    const row = state.rows.find((item) => item.ticker === active);
    if (!row) {
      els.chartSelection.textContent = '';
      els.chartSelection.hidden = true;
      return;
    }
    els.chartSelection.hidden = false;
    const scores = row.scores || {};
    els.chartSelection.innerHTML = `
      <strong>${escapeHtml(row.ticker)} <span>${escapeHtml(row.name || '')}</span></strong>
      <dl>
        <div><dt>프록시 비중</dt><dd>${formatPercent(row.proxyWeight)}</dd></div>
        <div><dt>가격 점수</dt><dd>${formatScore(scores.priceMomentum)}</dd></div>
        <div><dt>실적 점수</dt><dd>${formatScore(scores.earningsMomentum)}</dd></div>
        <div><dt>종합 점수</dt><dd>${formatScore(scores.combined)}</dd></div>
        <div><dt>신호</dt><dd>${escapeHtml(scores.label || '-')}</dd></div>
      </dl>`;
  }

  function renderLeaders() {
    const leaders = state.analysis.leaders || {};
    const groups = [
      ['종합 랭킹', leaders.combined || [], 'combined'],
      ['가격 모멘텀', leaders.priceMomentum || [], 'priceMomentum'],
      ['실적 모멘텀', leaders.earningsMomentum || [], 'earningsMomentum'],
      ['프록시 비중', leaders.proxyWeight || [], 'proxyWeight'],
    ];
    els.leaderGrid.innerHTML = groups.map(([title, rows, key]) => `<article class="leader-card">
      <p class="eyebrow">${escapeHtml(key)}</p>
      <h3>${escapeHtml(title)}</h3>
      <div class="leader-list">
        ${rows.slice(0, 5).map((row) => leaderItem(row, key)).join('') || '<p class="muted">데이터 없음</p>'}
      </div>
    </article>`).join('');
  }

  function leaderItem(row, key) {
    const value = key === 'proxyWeight' ? formatPercent(row.proxyWeight) : formatScore(row[key]);
    return `<div class="leader-item">
      <strong>${escapeHtml(row.ticker || '-')}</strong>
      <span>${escapeHtml(row.name || '')}<small>${escapeHtml(row.label || '')}</small></span>
      <span class="score-pill ${scoreClass(key === 'proxyWeight' ? row.proxyWeight * 3 : row[key])}">${value}</span>
    </div>`;
  }

  function renderMethodology() {
    const analysis = state.analysis;
    const sources = analysis.sources || {};
    els.sourceList.innerHTML = Object.values(sources).map((source) => `<li><a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>: ${escapeHtml(source.usage)}</li>`).join('');
    els.weightCaveat.textContent = analysis.methodology?.weightCaveat || els.weightCaveat.textContent;
    if (els.opsSelectedDate) els.opsSelectedDate.textContent = formatDate(state.selectedDate || analysis.dataAsOf);
    if (els.opsGeneratedAt) els.opsGeneratedAt.textContent = formatDateTime(analysis.generatedAt);
    if (els.opsWeightMethod) els.opsWeightMethod.textContent = analysis.index?.weightMethodLabel || '-';
    if (els.opsDataStatus) els.opsDataStatus.textContent = `${analysis.status?.level || 'unknown'} · ${analysis.status?.message || '-'}`;
    if (els.opsPublicReadback) {
      els.opsPublicReadback.textContent = analysis.status?.publicPagesReadback || '';
      els.opsPublicReadback.hidden = !analysis.status?.publicPagesReadback;
    }
  }

  function updateTable() {
    const query = (els.searchInput?.value || '').trim().toLowerCase();
    const sortKey = state.sortKey || els.sortSelect?.value || 'rank';
    const sortDirection = state.sortDirection || els.sortDirection?.value || defaultDirectionFor(sortKey);
    let rows = state.rows.filter((row) => {
      if (!query) return true;
      const haystack = rowSearchText(row);
      return haystack.includes(query);
    });
    rows = rows.sort((a, b) => compareRows(a, b, sortKey, sortDirection));
    state.filteredRows = rows;
    updateSortIndicators();
    renderTable(rows);
  }

  function compareRows(a, b, key, direction = 'desc') {
    const modifier = direction === 'asc' ? 1 : -1;
    const av = valueForSort(a, key);
    const bv = valueForSort(b, key);
    const aMissing = av === null || av === undefined || av === '';
    const bMissing = bv === null || bv === undefined || bv === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv), 'en', { numeric: true, sensitivity: 'base' }) * modifier;
    }
    return ((av > bv) - (av < bv)) * modifier;
  }

  function valueForSort(row, key) {
    if (key === 'ticker') return row.ticker || '';
    if (key === 'name') return row.name || '';
    if (key === 'label') return row.scores?.label || '';
    if (key in row) return normalizeSortValue(row[key]);
    if (row.scores && key in row.scores) return normalizeSortValue(row.scores[key]);
    if (row.metrics && key in row.metrics) return normalizeSortValue(row.metrics[key]);
    return null;
  }

  function rowSearchText(row) {
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
      scores.label,
    ].join(' ').toLowerCase();
  }

  function normalizeSortValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value;
    return value ?? null;
  }

  function defaultDirectionFor(key) {
    return ['rank', 'ticker', 'name', 'label'].includes(key) ? 'asc' : 'desc';
  }

  function syncSortControls() {
    if (els.sortSelect) els.sortSelect.value = state.sortKey;
    if (els.sortDirection) els.sortDirection.value = state.sortDirection;
  }

  function updateSortIndicators() {
    if (!els.table) return;
    els.table.querySelectorAll('thead th').forEach((th) => {
      const button = th.querySelector('[data-sort-key]');
      const indicator = th.querySelector('.sort-indicator');
      const active = button?.getAttribute('data-sort-key') === state.sortKey;
      th.setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
      if (indicator) indicator.textContent = active ? (state.sortDirection === 'asc' ? '↑' : '↓') : '';
    });
  }

  function renderTable(rows) {
    if (!els.tableBody) return;
    if (!rows.length) {
      els.tableBody.innerHTML = '<tr><td colspan="14">검색 결과가 없습니다.</td></tr>';
      return;
    }
    els.tableBody.innerHTML = rows.map((row) => {
      const metrics = row.metrics || {};
      const scores = row.scores || {};
      const selected = row.ticker === activeTicker();
      const pinned = row.ticker === state.pinnedTicker;
      return `<tr class="${selected ? 'is-selected' : ''}">
        <td>${formatNumber(row.rank, { maximumFractionDigits: 0 })}</td>
        <td><button class="ticker-select" type="button" data-table-ticker="${escapeAttr(row.ticker)}" aria-pressed="${pinned}">${escapeHtml(row.ticker)}</button></td>
        <td class="name-cell" title="${escapeAttr(row.name || '')}">${escapeHtml(row.name || '')}</td>
        <td>${formatPercent(row.proxyWeight)}</td>
        <td>${formatCurrency(row.price)}</td>
        <td>${formatCompact(row.marketCap)}</td>
        <td class="${numberClass(metrics.return3m)}">${formatPercent(metrics.return3m)}</td>
        <td class="${numberClass(metrics.return12m)}">${formatPercent(metrics.return12m)}</td>
        <td class="${numberClass(metrics.quarterlyRevenueYoY)}">${formatPercent(metrics.quarterlyRevenueYoY)}</td>
        <td class="${numberClass(metrics.quarterlyEpsYoY)}">${formatPercent(metrics.quarterlyEpsYoY)}</td>
        <td>${formatNumber(metrics.trailingPe, { maximumFractionDigits: 1 })}</td>
        <td><span class="score-pill ${scoreClass(scores.priceMomentum)}">${formatScore(scores.priceMomentum)}</span></td>
        <td><span class="score-pill ${scoreClass(scores.earningsMomentum)}">${formatScore(scores.earningsMomentum)}</span></td>
        <td><span class="signal-pill">${escapeHtml(scores.label || '-')}</span></td>
      </tr>`;
    }).join('');
  }

  function renderError(error) {
    const message = `데이터를 불러오지 못했습니다: ${error.message}`;
    if (els.sourceStatus) els.sourceStatus.innerHTML = chip('error', message);
    if (els.snapshotSummary) els.snapshotSummary.textContent = '저장된 기준일을 확인할 수 없습니다.';
    if (els.metricGrid) els.metricGrid.innerHTML = `<article class="metric-card"><p class="eyebrow">Error</p><div class="detail">${escapeHtml(message)} 잠시 후 다시 시도해 주세요.</div></article>`;
    if (els.tableBody) els.tableBody.innerHTML = `<tr><td colspan="14">${escapeHtml(message)}</td></tr>`;
  }

  function metricCard(label, value, detail) {
    return `<article class="metric-card">
      <p class="eyebrow">${escapeHtml(label)}</p>
      <div class="value">${escapeHtml(value ?? '-')}</div>
      <div class="detail">${escapeHtml(String(detail ?? ''))}</div>
    </article>`;
  }

  function chip(kind, text) {
    return `<span class="status-chip ${escapeAttr(kind)}">${escapeHtml(String(text ?? '-'))}</span>`;
  }

  function scoreClass(value) {
    if (!isFiniteNumber(value)) return '';
    if (value >= 0.67) return 'good';
    if (value < 0.35) return 'bad';
    return 'watch';
  }

  function numberClass(value) {
    if (!isFiniteNumber(value)) return '';
    return value >= 0 ? 'positive' : 'negative';
  }

  function formatNumber(value, options = {}) {
    if (!isFiniteNumber(value)) return '-';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, ...options }).format(value);
  }

  function formatCurrency(value) {
    if (!isFiniteNumber(value)) return '-';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value > 100 ? 0 : 2 }).format(value);
  }

  function formatCompact(value) {
    if (!isFiniteNumber(value)) return '-';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  }

  function formatPercent(value) {
    if (!isFiniteNumber(value)) return '-';
    return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(value);
  }

  function formatScore(value) {
    if (!isFiniteNumber(value)) return '-';
    return Math.round(value * 100).toString();
  }

  function formatDate(value) {
    if (!value) return '-';
    return String(value).slice(0, 10);
  }

  function formatDateTime(value) {
    if (!value) return '-';
    return String(value).replace('T', ' ').replace('Z', ' UTC');
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }
})();

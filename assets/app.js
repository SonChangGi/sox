(() => {
  'use strict';

  const DATA_URL = 'data/sox-analysis.json';
  const state = { analysis: null, rows: [], filteredRows: [], sortKey: 'rank', sortDirection: 'asc' };

  const els = {
    sourceStatus: document.querySelector('#source-status'),
    metricGrid: document.querySelector('#metric-grid'),
    weightChart: document.querySelector('#weight-chart'),
    priceChart: document.querySelector('#price-chart'),
    earningsChart: document.querySelector('#earnings-chart'),
    quadrantChart: document.querySelector('#quadrant-chart'),
    leaderGrid: document.querySelector('#leader-grid'),
    searchInput: document.querySelector('#search-input'),
    sortSelect: document.querySelector('#sort-select'),
    sortDirection: document.querySelector('#sort-direction'),
    table: document.querySelector('#constituent-table'),
    tableBody: document.querySelector('#constituent-body'),
    sourceList: document.querySelector('#source-list'),
    weightCaveat: document.querySelector('#weight-caveat'),
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindControls();
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const analysis = await response.json();
      state.analysis = analysis;
      state.rows = Array.isArray(analysis.constituents) ? analysis.constituents : [];
      state.filteredRows = [...state.rows];
      renderAll();
    } catch (error) {
      renderError(error);
    }
  }

  function bindControls() {
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
  }

  function renderAll() {
    renderStatus();
    renderMetrics();
    renderCharts();
    renderLeaders();
    renderMethodology();
    updateTable();
  }

  function renderStatus() {
    const analysis = state.analysis;
    const status = analysis.status || {};
    const coverage = analysis.coverage || {};
    const chips = [
      chip(status.level === 'ok' ? 'ok' : 'warning', status.level || 'unknown'),
      chip('neutral', `생성 ${formatDateTime(analysis.generatedAt)}`),
      chip('neutral', `기준 ${formatDate(analysis.dataAsOf)}`),
      chip('neutral', analysis.index?.weightMethodLabel || 'proxy weight'),
      chip(coverage.fundamentals?.ratio > 0.7 ? 'ok' : 'warning', `재무 커버리지 ${formatPercent(coverage.fundamentals?.ratio)}`),
    ];
    if (status.publicPagesReadback) chips.push(chip('warning', status.publicPagesReadback));
    els.sourceStatus.innerHTML = chips.join('');
  }

  function renderMetrics() {
    const analysis = state.analysis;
    const leaders = analysis.leaders || {};
    const topCombined = leaders.combined?.[0];
    const topWeight = leaders.proxyWeight?.[0];
    const topPrice = leaders.priceMomentum?.[0];
    const topEarnings = leaders.earningsMomentum?.[0];
    const cards = [
      metricCard('Constituents', formatNumber(analysis.index?.constituentCount, { maximumFractionDigits: 0 }), `${analysis.index?.constituentSource?.source || 'Nasdaq'} · ${analysis.index?.constituentSource?.tradeDate || '-'}`),
      metricCard('Top proxy weight', topWeight?.ticker || '-', `${formatPercent(topWeight?.proxyWeight)} · ${topWeight?.name || ''}`),
      metricCard('Top combined', topCombined?.ticker || '-', `${formatScore(topCombined?.combined)} · ${topCombined?.label || ''}`),
      metricCard('Data coverage', `${analysis.coverage?.price?.count || 0}/${analysis.index?.constituentCount || 0}`, `Price · fundamentals ${formatPercent(analysis.coverage?.fundamentals?.ratio)}`),
      metricCard('Price leader', topPrice?.ticker || '-', `${formatScore(topPrice?.priceMomentum)} · 3M ${formatPercent(topPrice?.return3m)}`),
      metricCard('Earnings leader', topEarnings?.ticker || '-', `${formatScore(topEarnings?.earningsMomentum)} · Rev YoY ${formatPercent(topEarnings?.quarterlyRevenueYoY)}`),
      metricCard('Weight method', analysis.index?.weightMethod === 'official' ? 'Official' : 'Proxy', analysis.index?.weightMethodLabel || 'market-cap proxy'),
      metricCard('Status', analysis.status?.level || 'unknown', analysis.status?.message || ''),
    ];
    els.metricGrid.innerHTML = cards.join('');
  }

  function renderCharts() {
    const leaders = state.analysis.leaders || {};
    renderBarChart(els.weightChart, leaders.proxyWeight || [], 'proxyWeight', { kind: 'percent', color: '' });
    renderBarChart(els.priceChart, leaders.priceMomentum || [], 'priceMomentum', { kind: 'score', color: 'green' });
    renderBarChart(els.earningsChart, leaders.earningsMomentum || [], 'earningsMomentum', { kind: 'score', color: 'amber' });
    renderQuadrant();
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
      const width = Math.max(4, Math.abs(row[key]) / max * 100);
      return `<div class="bar-row">
        <span class="bar-label">${escapeHtml(row.ticker)}</span>
        <span class="bar-track"><span class="bar-fill ${options.color || ''}" style="width:${width.toFixed(2)}%"></span></span>
        <span class="bar-value">${options.kind === 'score' ? formatScore(row[key]) : formatPercent(row[key])}</span>
      </div>`;
    }).join('');
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
    target.innerHTML = '<span class="quad-axis y">earnings momentum ↑</span><span class="quad-axis x">price momentum →</span>' + rows.map((row) => {
      const x = clamp(row.scores.priceMomentum, 0.03, 0.97) * 100;
      const y = (1 - clamp(row.scores.earningsMomentum, 0.03, 0.97)) * 100;
      return `<span class="quad-point" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" title="${escapeHtml(row.ticker)} · ${escapeHtml(row.scores.label || '')}">${escapeHtml(row.ticker)}</span>`;
    }).join('');
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
      return `<tr>
        <td>${formatNumber(row.rank, { maximumFractionDigits: 0 })}</td>
        <td><strong>${escapeHtml(row.ticker)}</strong></td>
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
    const message = `generated JSON을 불러오지 못했습니다: ${error.message}`;
    if (els.sourceStatus) els.sourceStatus.innerHTML = chip('error', message);
    if (els.metricGrid) els.metricGrid.innerHTML = `<article class="metric-card"><p class="eyebrow">Error</p><div class="detail">${escapeHtml(message)}<br/>로컬에서 <code>python3 scripts/fetch_sox_data.py --offline-ok</code>를 실행해 주세요.</div></article>`;
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

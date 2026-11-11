/* Shared by the Hub and standalone SOX scatterplots. Input positions are CSS pixels. */
(function (scope) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const distance = (p, x, y) => (p.x - x) ** 2 + (p.y - y) ** 2;
  const overlaps = (a, b, gap) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

  function layout(points, grid, measure, lineHeight = 14) {
    const inset = 2, gap = 2, placed = [];
    const ordered = points.map(p => ({
      ...p, width: Math.ceil(measure(p.ticker)) + 6, height: lineHeight,
      neighbors: points.reduce((sum, q) => sum + Number(distance(p, q.x, q.y) < 32 ** 2), 0),
    })).sort((a, b) => b.neighbors - a.neighbors || a.y - b.y || a.x - b.x || a.index - b.index);
    for (const p of ordered) {
      const left = grid.x + inset, right = grid.x + grid.width - p.width - inset;
      const top = grid.y + inset, bottom = grid.y + grid.height - p.height - inset;
      if (right < left || bottom < top) return [];
      let best, cost = Infinity;
      function candidate(x, y) {
        const box = {x: clamp(x, left, right), y: clamp(y, top, bottom), width: p.width, height: p.height};
        const edgeX = clamp(p.x, box.x, box.x + box.width), edgeY = clamp(p.y, box.y, box.y + box.height);
        const length = distance(p, edgeX, edgeY);
        if (length >= cost || placed.some(other => overlaps(box, other, gap))) return;
        if (points.some(q => distance(q, clamp(q.x, box.x, box.x + box.width), clamp(q.y, box.y, box.y + box.height)) < (q.radius ?? 5) ** 2)) return;
        // Prefer a short leader and avoid sending it across an already placed label.
        const crosses = placed.some(b => [0.25, 0.5, 0.75].some(t => {
          const x = p.x + (edgeX - p.x) * t, y = p.y + (edgeY - p.y) * t;
          return x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height;
        }));
        const score = length + (crosses ? 400 : 0);
        if (score < cost) { cost = score; best = {...box, edgeX, edgeY}; }
      }
      for (const offset of [7, 13, 21, 31, 44, 60, 80]) {
        for (const [x, y] of [
          [p.x + offset, p.y - p.height / 2], [p.x - p.width - offset, p.y - p.height / 2],
          [p.x - p.width / 2, p.y - p.height - offset], [p.x - p.width / 2, p.y + offset],
          [p.x + offset, p.y - p.height - offset], [p.x - p.width - offset, p.y - p.height - offset],
          [p.x + offset, p.y + offset], [p.x - p.width - offset, p.y + offset],
        ]) candidate(x, y);
        if (cost < offset ** 2) break;
      }
      if (!best) for (let y = top; y <= bottom + 5; y += 5) {
        for (let x = left; x <= right + 5; x += 5) candidate(x, y);
      }
      if (!best) {
        // Very dense selections can consume every clear patch. Pack into
        // non-overlapping rows as a last resort, still linking each ticker.
        return pack(ordered, grid, lineHeight, inset, gap);
      }
      placed.push({...best, ticker: p.ticker, index: p.index, pointX: p.x, pointY: p.y, leader: p.leader});
    }
    return placed;
  }

  function pack(points, grid, height, inset, gap) {
    const left = grid.x + inset, right = grid.x + grid.width - inset;
    const top = grid.y + inset, bottom = grid.y + grid.height - inset;
    let x = left, y = top;
    return [...points].sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index).flatMap(p => {
      if (x + p.width > right) { x = left; y += height + gap; }
      if (x + p.width > right || y + height > bottom) return [];
      const box = {x, y, width: p.width, height, ticker: p.ticker, index: p.index, pointX: p.x, pointY: p.y, leader: p.leader,
        edgeX: clamp(p.x, x, x + p.width), edgeY: clamp(p.y, y, y + height)};
      x += p.width + gap;
      return [box];
    });
  }

  function mount(host, chart, points, initial = '', {pointRing = false} = {}) {
    const doc = host.ownerDocument;
    const svg = (tag, attrs = {}) => {
      const el = doc.createElementNS(NS, tag);
      for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
      return el;
    };
    const layer = svg('svg', {'aria-hidden': 'true', 'data-sox-ticker-layer': '', focusable: 'false'});
    Object.assign(layer.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1', display: 'block'});
    host.append(layer);
    const ctx = doc.createElement('canvas').getContext('2d');
    const ring = pointRing ? svg('circle', {r: '5.5', fill: 'var(--qs-surface,#171e2d)', stroke: 'var(--qs-accent,#55cad1)', 'stroke-width': '2'}) : null;
    let labels = [], nodes = [], selected = initial, frame = 0, disposed = false;
    function setSelected(ticker) {
      selected = ticker;
      if (ring) {
        const point = labels.find(label => label.ticker === selected);
        ring.style.display = point ? '' : 'none';
        if (point) {
          ring.setAttribute('cx', point.pointX);
          ring.setAttribute('cy', point.pointY);
        }
      }
      for (const [label, text, line, bg] of nodes) {
        const active = selected === label.ticker;
        text.setAttribute('fill', active ? 'var(--qs-accent,#007c89)' : 'var(--qs-text,#edf2fb)');
        text.setAttribute('font-weight', active || label.leader ? '700' : '550');
        bg.setAttribute('fill', active ? 'var(--qs-raised,#22334a)' : 'var(--qs-surface,#171e2d)');
        bg.setAttribute('opacity', active ? '1' : '.85');
        if (line) line.setAttribute('stroke-opacity', active ? '.88' : '.47');
      }
    }
    function draw() {
      if (disposed) return;
      const rect = chart.getModel()?.getComponent('grid', 0)?.coordinateSystem?.getRect();
      if (!rect?.width || !rect.height) return;
      const family = doc.defaultView.getComputedStyle(host).fontFamily;
      const fontSize = host.clientWidth < 400 ? 10.5 : 11.5;
      if (ctx) ctx.font = `700 ${fontSize}px ${family}`;
      const measure = text => ctx?.measureText(text).width ?? text.length * fontSize * .68;
      const inside = (x, y) => x >= rect.x - .5 && x <= rect.x + rect.width + .5 && y >= rect.y - .5 && y <= rect.y + rect.height + .5;
      const visible = points.flatMap((p, index) => {
        const pixel = chart.convertToPixel({gridIndex: 0}, p.value);
        if (!pixel || !inside(...pixel)) return [];
        return [{...p, x: pixel[0], y: pixel[1], index}];
      });
      labels = layout(visible, rect, measure, 14);
      if (labels.length !== visible.length) labels = layout(visible, rect, measure, 12);
      const leaders = svg('g', {stroke: 'var(--qs-muted,#a8b5cc)', 'stroke-width': '0.8', fill: 'none'});
      const textLayer = svg('g', {'font-family': family, 'font-size': fontSize});
      nodes = labels.map(label => {
        const {x, y, width, height, edgeX, edgeY, pointX, pointY} = label;
        const len = Math.hypot(edgeX - pointX, edgeY - pointY);
        const inset = Math.min(4, len * .45);
        const line = len > 5 ? svg('line', {x1: pointX + (edgeX - pointX) * inset / len,
          y1: pointY + (edgeY - pointY) * inset / len, x2: edgeX, y2: edgeY}) : null;
        if (line) leaders.append(line);
        const bg = svg('rect', {x, y, width, height, rx: 3});
        const text = svg('text', {x: x + width / 2, y: y + height / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'data-sox-label': label.ticker});
        text.textContent = label.ticker;
        textLayer.append(bg, text);
        return [label, text, line, bg];
      });
      layer.replaceChildren(leaders, ...(ring ? [ring] : []), textLayer);
      setSelected(selected);
    }
    function schedule() {
      if (disposed || frame) return;
      frame = doc.defaultView.requestAnimationFrame(() => { frame = 0; draw(); });
    }
    draw();
    doc.fonts?.ready.then(schedule);
    return {
      schedule, setSelected,
      hit(x, y) { return labels.find(b => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height)?.index; },
      destroy() {
        disposed = true;
        if (frame) doc.defaultView.cancelAnimationFrame(frame);
        layer.remove();
      },
    };
  }

  scope.QuantSoxLabels = {layout, mount};
})(globalThis);

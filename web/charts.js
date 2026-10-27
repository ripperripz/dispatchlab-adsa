// Small dependency-free SVG charts (line, bar, range, histogram).
(function () {
  'use strict';
  const DL = (window.DL = window.DL || {});
  const NS = 'http://www.w3.org/2000/svg';

  function svg(w, hgt) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    s.setAttribute('class', 'chart');
    s.setAttribute('role', 'img');
    return s;
  }
  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function niceTicks(lo, hi, n = 5) {
    const span = hi - lo || 1;
    const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function logTicks(lo, hi) {
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) out.push(Math.pow(10, e));
    return out;
  }

  // series: [{name, color, points:[[x,y],...]}]; opts: {xLabel, yLabel, yFormat, xFormat, log, height, step}
  function lineChart(series, opts = {}) {
    const W = opts.width || 640, H = opts.height || 240, m = { l: 60, r: 24, t: 12, b: 34 };
    const s = svg(W, H);
    s.setAttribute('aria-label', opts.label || 'Line chart');
    const xs = series.flatMap(se => se.points.map(p => p[0])), ys = series.flatMap(se => se.points.map(p => p[1]));
    if (!xs.length) return s;
    const x0 = opts.xMin ?? Math.min(...xs), x1 = opts.xMax ?? Math.max(...xs);
    let y0 = opts.log ? Math.min(...ys.filter(v => v > 0)) : Math.min(0, ...ys), y1 = Math.max(...ys);
    if (opts.log) { y0 = Math.pow(10, Math.floor(Math.log10(y0))); y1 = Math.pow(10, Math.ceil(Math.log10(y1))); }
    else y1 = niceTicks(y0, y1).slice(-1)[0] >= y1 ? niceTicks(y0, y1).slice(-1)[0] : y1;
    const X = v => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = v => opts.log
      ? H - m.b - ((Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0) || 1)) * (H - m.t - m.b)
      : H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    const g = el('g', { class: 'grid' });
    const yt = opts.log ? logTicks(y0, y1) : niceTicks(y0, y1);
    const yf = opts.yFormat || (v => v);
    for (const t of yt) {
      g.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
      g.appendChild(el('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, yf(t)));
    }
    const xt = opts.xTicks || niceTicks(x0, x1, 6);
    const xf = opts.xFormat || (v => v);
    for (const t of xt) g.appendChild(el('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, xf(t)));
    s.appendChild(g);
    s.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: 'var(--border-strong)' }));
    if (opts.xLabel) s.appendChild(el('text', { x: W - m.r, y: H - 4, 'text-anchor': 'end' }, opts.xLabel));
    for (const se of series) {
      const pts = se.points;
      let d = '';
      pts.forEach((p, i) => {
        const x = X(p[0]), y = Y(p[1]);
        if (opts.step && i) d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
        else d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      });
      s.appendChild(el('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (opts.dots) {
        for (const p of pts) {
          const c = el('circle', { cx: X(p[0]), cy: Y(p[1]), r: 3.5, fill: 'var(--surface)', stroke: se.color, 'stroke-width': 2 });
          c.appendChild(el('title', {}, `${se.name}: ${yf(p[1])}`));
          s.appendChild(c);
        }
      }
    }
    return s;
  }

  // Overlaid histograms. series: [{name,color,values:[...]}]
  function histogram(series, opts = {}) {
    const all = series.flatMap(se => se.values);
    const W = 640, H = opts.height || 220, m = { l: 40, r: 12, t: 10, b: opts.xLabel ? 46 : 32 };
    const s = svg(W, H);
    s.setAttribute('aria-label', opts.label || 'Histogram');
    if (!all.length) return s;
    const lo = 0, hi = Math.max(...all);
    const bins = opts.bins || 24, bw = (hi - lo) / bins || 1;
    const counts = series.map(se => {
      const c = new Array(bins).fill(0);
      for (const v of se.values) c[Math.min(bins - 1, Math.floor((v - lo) / bw))]++;
      return c;
    });
    const ymax = Math.max(1, ...counts.flat());
    const X = v => m.l + ((v - lo) / (hi - lo || 1)) * (W - m.l - m.r);
    const Y = v => H - m.b - (v / ymax) * (H - m.t - m.b);
    const g = el('g', { class: 'grid' });
    for (const t of niceTicks(0, ymax, 4)) {
      g.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
      g.appendChild(el('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, t));
    }
    for (const t of niceTicks(lo, hi, 7)) g.appendChild(el('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, (opts.xFormat || (v => v))(t)));
    s.appendChild(g);
    // Series sit side by side inside each bin (no overlap, no colour mixing).
    counts.forEach((c, si) => {
      c.forEach((v, i) => {
        if (!v) return;
        const x0b = X(lo + i * bw), wb = X(lo + (i + 1) * bw) - x0b;
        const w = (wb - 2) / series.length, x = x0b + 1 + si * w;
        const r = el('rect', { x, y: Y(v), width: Math.max(1, w - 0.5), height: H - m.b - Y(v), fill: series[si].color, 'fill-opacity': 0.85, rx: 1 });
        r.appendChild(el('title', {}, `${series[si].name}: ${v} orders in ${(lo + i * bw).toFixed(0)}–${(lo + (i + 1) * bw).toFixed(0)}`));
        s.appendChild(r);
      });
    });
    s.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: 'var(--border-strong)' }));
    if (opts.xLabel) s.appendChild(el('text', { x: W - m.r, y: H - 4, 'text-anchor': 'end' }, opts.xLabel));
    return s;
  }

  // Latency range rows: median bar with p95 and p99 ticks on a shared (log) axis.
  // rows: [{label, color, median, p95, p99}]
  function latencyRanges(rows, opts = {}) {
    const W = 640, rowH = 34, m = { l: 112, r: 40, t: 8, b: 30 }, H = m.t + m.b + rows.length * rowH;
    const s = svg(W, H);
    s.setAttribute('aria-label', opts.label || 'Latency percentiles');
    const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...rows.map(r => r.median))))),
      hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...rows.map(r => r.p99)))));
    const X = v => m.l + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - m.l - m.r);
    const g = el('g', { class: 'grid' });
    for (const t of logTicks(lo, hi)) {
      g.appendChild(el('line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b }));
      g.appendChild(el('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, DL.fmt.us(t)));
    }
    s.appendChild(g);
    rows.forEach((r, i) => {
      const y = m.t + i * rowH + rowH / 2;
      s.appendChild(el('text', { x: 0, y: y + 4, 'font-weight': 500, fill: 'var(--text)' }, r.label));
      s.appendChild(el('line', { x1: X(r.median), x2: X(r.p99), y1: y, y2: y, stroke: r.color, 'stroke-opacity': 0.35, 'stroke-width': 2 }));
      const bar = el('rect', { x: X(lo), y: y - 7, width: X(r.median) - X(lo), height: 14, rx: 3, fill: r.color, 'fill-opacity': 0.85 });
      bar.appendChild(el('title', {}, `${r.label}: median ${DL.fmt.us(r.median)}, p95 ${DL.fmt.us(r.p95)}, p99 ${DL.fmt.us(r.p99)}`));
      s.appendChild(bar);
      for (const [v, name] of [[r.p95, 'p95'], [r.p99, 'p99']]) {
        const t = el('line', { x1: X(v), x2: X(v), y1: y - 8, y2: y + 8, stroke: r.color, 'stroke-width': 2, 'stroke-linecap': 'round' });
        t.appendChild(el('title', {}, `${r.label} ${name}: ${DL.fmt.us(v)}`));
        s.appendChild(t);
      }
    });
    return s;
  }

  // Area sparkline of a cumulative count over [0, T] (scrubber backdrop).
  function cumulativeArea(times, T, color) {
    const W = 1000, H = 36;
    const s = svg(W, H);
    s.setAttribute('preserveAspectRatio', 'none');
    s.setAttribute('aria-hidden', 'true');
    if (!times.length) return s;
    let d = `M0,${H}`;
    times.forEach((t, i) => { d += `L${((t / T) * W).toFixed(1)},${(H - ((i + 1) / times.length) * (H - 4)).toFixed(1)}`; });
    d += `L${W},${(H - (H - 4)).toFixed(1)}L${W},${H}Z`;
    s.appendChild(el('path', { d, fill: color, 'fill-opacity': 0.14, stroke: 'none' }));
    return s;
  }

  function legend(items) {
    return DL.h('div.chart-legend', items.map(i => DL.h('span', DL.h('span.legend-line', { style: { background: i.color } }), i.label)));
  }

  DL.charts = { lineChart, histogram, latencyRanges, cumulativeArea, legend };
})();

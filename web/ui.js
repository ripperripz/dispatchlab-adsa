// Shared UI helpers: DOM builder, icons, formatting, toast, theme.
(function () {
  'use strict';
  const DL = (window.DL = window.DL || {});

  // h('div.cls#id', {attrs}, ...children): tiny hyperscript.
  function h(tag, attrs, ...children) {
    const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
    const node = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, k, v) => {
      if (k === '.') node.classList.add(v); else node.id = v;
    });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    for (const c of children.flat(Infinity)) {
      if (c === undefined || c === null || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Icon set: 16px grid, 1.5 stroke, round joins (drawn for this console).
  const P = {
    overview: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
    route: '<circle cx="3.5" cy="12.5" r="1.5"/><circle cx="12.5" cy="3.5" r="1.5"/><path d="M5 12.5h3.5a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4H11"/>',
    simulation: '<circle cx="8" cy="8" r="5.5"/><path d="M6.8 5.8v4.4L10.4 8z"/>',
    policies: '<path d="M8 2.5v11M4.5 13.5h7M3 5.5h10"/><path d="M3 5.5l-1.5 4a1.8 1.8 0 0 0 3 0zM13 5.5l-1.5 4a1.8 1.8 0 0 0 3 0z"/>',
    benchmarks: '<path d="M2.5 13.5h11"/><rect x="3.5" y="8" width="2" height="4" rx=".5"/><rect x="7" y="4" width="2" height="8" rx=".5"/><rect x="10.5" y="6" width="2" height="6" rx=".5"/>',
    correctness: '<path d="M8 1.8l5 1.9v4c0 3.2-2.2 5.6-5 6.5-2.8-.9-5-3.3-5-6.5v-4z"/><path d="M5.8 8l1.6 1.6L10.4 6.6"/>',
    sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
    moon: '<path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8z"/>',
    monitor: '<rect x="2" y="3" width="12" height="8" rx="1.2"/><path d="M6 13.5h4M8 11v2.5"/>',
    play: '<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="4.5" y="3.5" width="2.2" height="9" rx=".6" fill="currentColor" stroke="none"/><rect x="9.3" y="3.5" width="2.2" height="9" rx=".6" fill="currentColor" stroke="none"/>',
    restart: '<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v2.8h2.8"/>',
    shuffle: '<path d="M2 4.5h2.5c3 0 4 7 7 7H14M2 11.5h2.5c1.3 0 2.2-1.3 3-2.8M10 4.5h4M12 2.5l2 2-2 2M12 9.5l2 2-2 2"/>',
    swap: '<path d="M4.5 2.5v11M2.5 4.5l2-2 2 2M11.5 13.5v-11M9.5 11.5l2 2 2-2"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7"/>',
    check: '<path d="M3 8.5l3 3 7-7"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    alert: '<path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3.2M8 11.6v.1"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    minus: '<path d="M3 8h10"/>',
    fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
    bolt: '<path d="M9 1.8L3.5 9H8l-1 5.2L12.5 7H8z"/>',
    external: '<path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>',
  };
  function icon(name, cls) {
    const span = document.createElement('span');
    span.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${P[name] || ''}</svg>`;
    return span.firstChild;
  }

  // ---- formatting
  const nf = new Intl.NumberFormat('en-US');
  const fmt = {
    compact: v => (v >= 10000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : nf.format(Math.round(v))),
    int: v => (v === null || v === undefined || Number.isNaN(v) ? '–' : nf.format(Math.round(v))),
    num: (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })),
    // Microseconds to a readable latency.
    us: v => {
      if (v === null || v === undefined) return '–';
      if (v < 1) return `${v.toFixed(2)} µs`;
      if (v < 1000) return `${v.toFixed(v < 10 ? 1 : 0)} µs`;
      return `${(v / 1000).toFixed(v < 10000 ? 2 : 1)} ms`;
    },
    // Milliseconds of travel time to m:ss (or h:mm:ss).
    dur: ms => {
      if (ms === null || ms === undefined || ms < 0) return '–';
      const s = Math.round(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
      return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
    },
    clock: ms => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    },
    km: m => (m === null || m === undefined ? '–' : `${(m / 1000).toFixed(2)} km`),
    bytes: b => (b < 1048576 ? `${(b / 1024).toFixed(1)} KiB` : `${(b / 1048576).toFixed(1)} MiB`),
    min: v => (v === null || v === undefined ? '–' : `${Number(v).toFixed(1)} min`),
    pct: v => `${(v * 100).toFixed(1)}%`,
    signed: (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d),
  };

  const ALGOS = [
    { id: 'dijkstra', label: 'Dijkstra', color: 'var(--s-dijkstra)' },
  ];
  const POLICIES = [
    { id: 'nearest', label: 'Nearest', color: 'var(--p-nearest)' },
    { id: 'greedy_eta', label: 'Greedy ETA', color: 'var(--p-greedy_eta)' },
  ];
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function algoTag(a) {
    return h('span.algo', h('span.swatch', { style: { background: a.color } }), a.label);
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch (e) {
      toast('Copy failed: select the text and copy it manually');
    }
  }

  // Shell command block with a copy button.
  function command(text) {
    return h('div.cmd', h('code', text),
      h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': 'Copy command', onclick: () => copy(text) }, icon('copy')));
  }

  function segmented(options, value, onChange, opts = {}) {
    const root = h('div.segmented' + (opts.full ? '.full' : ''), { role: 'group', 'aria-label': opts.label || '' });
    const buttons = options.map(o => {
      const b = h('button', { type: 'button', 'aria-pressed': String(o.value === value), title: o.title || null },
        o.icon ? icon(o.icon) : null, o.label || null);
      if (o.icon && !o.label) b.setAttribute('aria-label', o.title || o.value);
      b.addEventListener('click', () => {
        buttons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        onChange(o.value);
      });
      root.appendChild(b);
      return b;
    });
    root.set = v => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v)));
    return root;
  }

  function field(label, input, hint) {
    const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
    input.id = id;
    return h('div.field', h('label', { for: id }, label), input, hint ? h('span.hint', hint) : null);
  }

  function numberInput(value, min, max, step = 1) {
    return h('input.input', { type: 'number', value, min, max, step, inputmode: 'numeric' });
  }

  function readInt(input, min, max) {
    const v = Number(input.value);
    const ok = Number.isInteger(v) && v >= min && v <= max;
    input.setAttribute('aria-invalid', String(!ok));
    return ok ? v : null;
  }

  function errorCallout(err) {
    return h('div.callout', { role: 'alert' }, icon('alert'), h('div', String(err && err.message ? err.message : err)));
  }

  function setLoading(btn, on, labelWhileLoading) {
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.classList.add('loading');
      btn.setAttribute('aria-busy', 'true');
      if (labelWhileLoading) btn.lastChild.textContent = labelWhileLoading;
    } else {
      btn.classList.remove('loading');
      btn.removeAttribute('aria-busy');
      if (btn.dataset.label && labelWhileLoading) btn.lastChild.textContent = btn.dataset.label;
    }
  }

  // ---- theme
  const theme = {
    pref() {
      try { return localStorage.getItem('dl-theme') || 'system'; } catch (e) { return 'system'; }
    },
    apply(pref) {
      try { localStorage.setItem('dl-theme', pref); } catch (e) { /* storage unavailable */ }
      const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      window.dispatchEvent(new CustomEvent('dl-theme'));
    },
  };

  Object.assign(DL, { h, append, icon, fmt, ALGOS, POLICIES, cssVar, algoTag, toast, copy, command, segmented, field, numberInput, readInt, errorCallout, setLoading, theme });
})();

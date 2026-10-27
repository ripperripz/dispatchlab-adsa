// Policies: Nearest vs Greedy ETA on one shared scenario.
(function () {
  'use strict';
  const DL = window.DL;
  const { h, icon, fmt } = DL;
  DL.views = DL.views || {};
  DL.state = DL.state || {};
  const S = (DL.state.policies = DL.state.policies || {
    params: { couriers: 40, orders: 300, window: 120, seed: 7 },
    compare: null,
  });

  const METRICS = [
    { key: 'orders_delivered', label: 'Completed orders', f: fmt.int, better: 'higher' },
    { key: 'orders_undelivered', label: 'Undelivered at end', f: fmt.int, better: 'lower' },
    { key: 'avg_delivery_min', label: 'Average delivery', f: fmt.min, better: 'lower', d: 2 },
    { key: 'p95_delivery_min', label: 'p95 delivery', f: fmt.min, better: 'lower', d: 2 },
    { key: 'avg_wait_for_courier_min', label: 'Average wait for a courier', f: fmt.min, better: 'lower', d: 2 },
    { key: 'courier_utilization', label: 'Courier utilization', f: fmt.pct, better: null },
    { key: 'total_distance_km', label: 'Total travel', f: v => `${fmt.num(v, 1)} km`, better: 'lower', d: 1 },
    { key: 'decision_mean_us', label: 'Decision time (mean)', f: fmt.us, better: 'lower', wall: true },
  ];

  DL.views.policies = {
    mount(root) {
      const page = h('div.page.fade-in');
      root.appendChild(page);
      let alive = true;

      page.appendChild(h('div.page-head', h('div', h('h1', 'Dispatch policies'),
        h('p', 'Nearest picks the free courier closest to the restaurant in a straight line. Greedy ETA picks the one who would deliver earliest, using real road travel times: one Dijkstra run backwards from the restaurant gives every courier’s time to reach it. Both policies run on the same generated scenario.'))));

      // ---- live head-to-head
      const live = h('section.section', { style: { marginTop: 0 } });
      page.appendChild(live);
      live.appendChild(h('div.section-head', h('div', h('h2', 'Head-to-head'), h('p', 'One scenario, both policies: same orders, same restaurants, same courier starting points.'))));
      const out = h('div');
      if (DL.api.live) {
        const inputs = {
          couriers: DL.numberInput(S.params.couriers, 1, 500), orders: DL.numberInput(S.params.orders, 1, 3000),
          window: DL.numberInput(S.params.window, 10, 1440), seed: DL.numberInput(S.params.seed, 0, 2147483647),
        };
        const btn = h('button.btn.primary', { type: 'button' }, icon('policies'), 'Compare policies');
        live.appendChild(h('div.panel', h('div.panel-body', h('div.form-row',
          DL.field('Couriers', inputs.couriers), DL.field('Orders', inputs.orders), DL.field('Window (min)', inputs.window),
          DL.field('Seed', inputs.seed), h('div', { style: { marginLeft: 'auto' } }, btn)))));
        btn.addEventListener('click', async () => {
          const p = {
            couriers: DL.readInt(inputs.couriers, 1, 500), orders: DL.readInt(inputs.orders, 1, 3000),
            window: DL.readInt(inputs.window, 10, 1440), seed: DL.readInt(inputs.seed, 0, 2147483647),
          };
          if (Object.values(p).some(v => v === null)) { out.replaceChildren(DL.errorCallout('Check the highlighted fields.')); return; }
          Object.assign(S.params, p);
          btn.classList.add('loading');
          btn.disabled = true;
          out.replaceChildren(h('div.grid.grid-2', { style: { marginTop: '16px' } }, h('div.skeleton', { style: { height: '320px' } }), h('div.skeleton', { style: { height: '320px' } })));
          try {
            S.compare = await DL.api.get('/api/compare', { ...S.params });
            if (alive) renderCompare();
          } catch (e) {
            if (alive) out.replaceChildren(h('div', { style: { marginTop: '16px' } }, DL.errorCallout(e)));
          } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
          }
        });
        live.appendChild(out);
        if (S.compare) renderCompare();
        else out.appendChild(h('p.muted', { style: { marginTop: '12px', fontSize: '13px' } }, 'The defaults are a peak-load scenario (300 orders in two hours), where the two policies are most likely to differ.'));
      } else {
        live.appendChild(DL.serverRequired('Comparisons run on the engine', 'Each comparison simulates both policies in C++ on the same scenario.'));
      }

      function renderCompare() {
        const c = S.compare;
        const [a, b] = c.runs;
        const rows = METRICS.map(m => {
          const va = a.metrics[m.key], vb = b.metrics[m.key], d = vb - va;
          let cls = 'r delta-flat';
          if (m.better && Math.abs(d) > 1e-9) cls = (m.better === 'lower' ? d < 0 : d > 0) ? 'r delta-good' : 'r delta-bad';
          const dtxt = m.key === 'courier_utilization' ? `${fmt.signed(d * 100, 1)} pt` : m.wall ? `${fmt.int(vb / Math.max(va, 1e-9))}× slower` : fmt.signed(d, m.d ?? 0);
          return h('tr', h('td', m.label, m.wall ? h('span.faint', ' · wall clock') : null), h('td.r', m.f(va)), h('td.r', m.f(vb)), h('td', { class: cls }, dtxt));
        });
        const chartCum = DL.charts.lineChart(c.runs.map((r, i) => ({
          name: DL.POLICIES[i].label, color: DL.POLICIES[i].color,
          points: [[0, 0], ...r.delivered_at_min.map((t, k) => [t, k + 1])],
        })), { step: true, xFormat: v => `${v}m`, height: 220, label: 'Cumulative deliveries over time' });
        const hist = DL.charts.histogram(c.runs.map((r, i) => ({ name: DL.POLICIES[i].label, color: DL.POLICIES[i].color, values: r.delivery_min })),
          { xFormat: v => `${Math.round(v)}`, xLabel: 'minutes from order to door', height: 200, label: 'Distribution of delivery times' });
        out.replaceChildren(h('div.fade-in', { style: { marginTop: '16px' } },
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px', fontSize: '13px' } },
            h('span.badge.ok', icon('check'), 'Same scenario for both'),
            h('span.muted', `${c.scenario.couriers} couriers · ${fmt.int(c.scenario.orders)} orders over ${c.scenario.window_min} min · seed ${c.scenario.seed}`)),
          h('div.grid.grid-2',
            h('div.panel', h('div.table-wrap', h('table.data',
              h('thead', h('tr', h('th', 'Metric'), h('th.r', DL.algoTag(DL.POLICIES[0])), h('th.r', DL.algoTag(DL.POLICIES[1])), h('th', 'Greedy ETA vs Nearest'))),
              h('tbody', rows))),
              h('div.panel-foot', 'Green marks the better value; utilization has no better direction. Decision time is wall-clock time per dispatch decision.')),
            h('div.panel', h('div.panel-head', h('h2', 'Deliveries over time'), DL.charts.legend(DL.POLICIES)),
              h('div.panel-body', chartCum),
              h('div.panel-head', { style: { borderTop: '1px solid var(--border)' } }, h('h2', 'Delivery time distribution')),
              h('div.panel-body', hist)))));
      }

      return () => { alive = false; };
    },
  };
})();

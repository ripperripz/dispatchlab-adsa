// Overview: the road network, its size, and what the engine does with it.
(function () {
  'use strict';
  const DL = window.DL;
  const { h, icon, fmt } = DL;
  DL.views = DL.views || {};

  // The four building blocks, in the order data flows through them.
  const STEPS = [
    ['Road graph', 'graph.cpp', '142k intersections and 298k one-way road segments, stored in compressed sparse row (CSR) arrays. Each edge weight is a travel time in milliseconds.'],
    ['Binary min-heap', 'graph.cpp', 'A priority queue in an array: the next-closest node comes out in O(log n). Dijkstra pops from it on every step.'],
    ['Dijkstra', 'graph.cpp', 'Finds the fastest route between two points, and, run backwards from a restaurant, the travel time of every courier to it.'],
    ['Delivery simulation', 'simulation.cpp', 'Orders, cooking, couriers driving and delivering, processed in time order from a priority queue of events.'],
  ];

  DL.views.overview = {
    mount(root) {
      const page = h('div.page.fade-in');
      root.appendChild(page);
      let map = null;
      let alive = true;

      page.appendChild(h('div.page-head',
        h('div', h('h1', 'Tricity road network'),
          h('p', 'Chandigarh, Mohali and Panchkula from OpenStreetMap. Every route on this console is computed by Dijkstra’s algorithm in C++, on the real road network.')),
        h('div.form-row',
          h('a.btn', { href: '#/simulation' }, icon('simulation'), 'Run a simulation'),
          h('a.btn.primary', { href: '#/routing' }, icon('route'), 'Open routing lab'))));

      const grid = h('div.grid.grid-3-1.stretch');
      page.appendChild(grid);
      const mapPanel = h('section.panel.column',
        h('div.panel-head', h('h2', 'Road network'), h('span.sub', matchMedia('(pointer: coarse)').matches ? 'Drag to pan · pinch to zoom' : 'Drag to pan · scroll to zoom')));
      const host = h('div.map-host', { style: { background: 'var(--map-bg)' } });
      const facts = h('dl.facts');
      mapPanel.append(host, facts);
      grid.appendChild(mapPanel);

      const side = h('section.panel', h('div.panel-head', h('h2', 'How it works')),
        h('ol.steps', STEPS.map(([title, file, text], i) => h('li',
          h('span.step-n', String(i + 1)),
          h('div', h('div.step-title', title, h('code.step-file', file)), h('p', text))))));
      grid.appendChild(side);

      const fact = (label, value, unit) => h('div.fact', h('dt', label), h('dd', value, unit ? h('small', unit) : null));

      (async () => {
        if (!DL.api.live) {
          host.appendChild(h('div.panel-body', DL.serverRequired('The engine is not running',
            'This console draws the road network and runs Dijkstra in the C++ engine.')));
          return;
        }
        const net = await DL.api.network();
        if (!alive) return;
        const canvas = h('canvas.map-canvas', { 'aria-label': 'Map of the Tricity road network' });
        host.appendChild(canvas);
        map = new DL.MapView(canvas, net, { padding: 16 });
        host.appendChild(DL.MapView.tools(map));
        host.appendChild(h('div.map-legend',
          h('span', h('span.legend-line', { style: { background: 'var(--map-arterial)', height: '3px' } }), 'Main roads'),
          h('span', h('span.legend-line', { style: { background: 'var(--map-road)' } }), 'Local roads')));
        const g = DL.api.info.graph;
        facts.append(
          fact('Intersections (nodes)', fmt.int(g.nodes)),
          fact('Road segments (edges)', fmt.int(g.edges)),
          fact('Road length', fmt.int(g.total_length_km), 'km'),
          fact('Fastest road', g.max_speed_kmh, 'km/h'));
      })().catch(e => { if (alive) page.appendChild(DL.errorCallout(e)); });

      return () => { alive = false; if (map) map.destroy(); };
    },
  };
})();

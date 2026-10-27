// Routing lab: pick two points, run Dijkstra on the engine, and watch the
// nodes it settled appear in the order it settled them.
(function () {
  'use strict';
  const DL = window.DL;
  const { h, icon, fmt } = DL;
  DL.views = DL.views || {};
  DL.state = DL.state || {};
  const S = (DL.state.routing = DL.state.routing || { s: null, t: null, result: null });

  const SWEEP_MS = 1800;
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  const ease = x => 1 - Math.pow(1 - x, 3);

  DL.views.routing = {
    mount(root) {
      root.className = 'view fill';
      const ws = h('div.workspace.fade-in');
      root.appendChild(ws);
      const stage = h('div.stage');
      const host = h('div.map-host');
      stage.append(host);
      const insp = h('aside.inspector', { 'aria-label': 'Route inspector' });
      ws.append(stage, insp);

      let alive = true, map = null, net = null, raf = 0, armed = 'a', inflight = 0;
      let sweepStart = 0, progress = 1;

      const canvas = h('canvas.map-canvas.pick', { 'aria-label': 'Map: click to place origin and destination' });
      host.appendChild(canvas);
      const hint = h('div.map-hint', icon('route'), h('span', 'Click the map to place the origin'));
      host.appendChild(hint);

      // ---- inspector
      const endA = h('button.endpoint', { type: 'button', style: { width: '100%', textAlign: 'left', cursor: 'pointer' } });
      const endB = h('button.endpoint', { type: 'button', style: { width: '100%', textAlign: 'left', cursor: 'pointer' } });
      endA.addEventListener('click', () => arm('a'));
      endB.addEventListener('click', () => arm('b'));
      const randomBtn = h('button.btn', { type: 'button', onclick: randomPair, title: 'Random origin and destination (R)' }, icon('shuffle'), 'Random pair');
      const swapBtn = h('button.btn.icon', { type: 'button', onclick: swap, 'aria-label': 'Swap origin and destination' }, icon('swap'));
      const resultBox = h('div');
      const replayBtn = h('button.btn.sm', { type: 'button', onclick: () => sweep(), disabled: true }, icon('restart'), 'Replay search');

      insp.append(
        h('section.insp-section',
          h('h2', 'Route', h('span.kbd', 'R')),
          endA, endB,
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, randomBtn, swapBtn)),
        h('section.insp-section.grow', h('h2', 'Dijkstra', replayBtn), resultBox),
        h('section.insp-section',
          h('h2', 'What you are seeing'),
          h('p.muted', { style: { fontSize: '12.5px', lineHeight: '1.55' } },
            'Each blue dot is a node Dijkstra settled: its fastest travel time from A became final. ' +
            'Nodes come out of the min-heap closest first, so the search grows like a ripple from A ' +
            'until it reaches B. The orange line is the shortest path, rebuilt by following parent pointers back from B.')));

      if (!DL.api.live) {
        hint.hidden = true;
        insp.replaceChildren(h('section.insp-section', DL.serverRequired('The routing lab runs on the engine',
          'Every query runs Dijkstra in C++ on the 142k-node road graph.')));
      }

      function endpointView(btn, which, node) {
        const label = which === 'a' ? 'Origin' : 'Destination';
        btn.replaceChildren(
          h('span.pin.' + which, which.toUpperCase()),
          h('div.meta',
            h('div', node === null ? h('span.muted', `${label}: click the map`) : h('span', label, h('span.faint', ` · node ${fmt.int(node)}`))),
            node === null ? null : h('div.faint.mono', `${net.lat[node].toFixed(5)}, ${net.lon[node].toFixed(5)}`)));
        btn.classList.toggle('armed', armed === which);
        btn.setAttribute('aria-pressed', String(armed === which));
      }
      function refreshEndpoints() {
        if (!net) return;
        endpointView(endA, 'a', S.s);
        endpointView(endB, 'b', S.t);
        const verb = coarse() ? 'Tap' : 'Click';
        hint.lastChild.textContent = armed === 'a' ? `${verb} the map to place the origin` : armed === 'b' ? `${verb} the map to place the destination`
          : coarse() ? 'Drag to pan · pinch to zoom · tap an endpoint to move it' : 'Drag to pan · scroll to zoom · click an endpoint to move it';
      }
      function arm(which) { armed = which; canvas.classList.toggle('pick', !!armed); refreshEndpoints(); }

      function randomPair() {
        if (!net || !DL.api.live) return;
        S.s = Math.floor(Math.random() * net.n);
        S.t = Math.floor(Math.random() * net.n);
        armed = null;
        refreshEndpoints();
        run();
      }
      function swap() {
        if (S.s === null || S.t === null) return;
        [S.s, S.t] = [S.t, S.s];
        refreshEndpoints();
        run();
      }

      // ---- running a query
      async function run() {
        if (!DL.api.live || S.s === null || S.t === null) return;
        const id = ++inflight;
        resultBox.replaceChildren(h('div', { style: { display: 'grid', gap: '10px' } },
          h('div.skeleton', { style: { height: '34px', width: '60%' } }),
          h('div.skeleton', { style: { height: '120px' } })));
        hint.lastChild.textContent = 'Running Dijkstra on the engine…';
        try {
          const res = await DL.api.get('/api/route', { s: S.s, t: S.t, trace: 1 });
          if (!alive || id !== inflight) return;
          S.result = res;
          showResult();
          if (map) map.fit(DL.MapView.boundsOf(net, res.trace.concat(res.path), 0.12));
          sweep();
        } catch (e) {
          if (!alive || id !== inflight) return;
          resultBox.replaceChildren(DL.errorCallout(e));
        } finally {
          if (alive && id === inflight) refreshEndpoints();
        }
      }

      function showResult() {
        const r = S.result;
        replayBtn.disabled = !r;
        if (!r) {
          resultBox.replaceChildren(h('p.muted', { style: { fontSize: '13px' } }, 'Place an origin and a destination, or press R for a random pair.'));
          return;
        }
        if (!r.reachable) {
          resultBox.replaceChildren(h('div.callout', icon('alert'), h('div', 'No route: the destination cannot be reached from the origin.')));
          return;
        }
        const stat = (k, v) => h('div', h('dt', k), h('dd', v));
        resultBox.replaceChildren(
          h('div.summary-line', h('span.big', fmt.dur(r.cost_ms)), h('span.muted', `${fmt.km(r.length_m)} · ${fmt.int(r.path.length - 1)} segments`)),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '10px 0 14px' } },
            r.path_cost_ok ? h('span.badge.ok', icon('check'), 'Path checked: edge times add up') : h('span.badge.err', icon('x'), 'Path does not add up')),
          h('dl.stat-grid', stat('Nodes settled', fmt.int(r.settled)), stat('Edges relaxed', fmt.int(r.relaxed)), stat('Engine time', fmt.us(r.latency_us))),
          h('p.muted', { style: { fontSize: '12px', marginTop: '12px' } },
            `Dijkstra settled ${fmt.int(r.settled)} of ${fmt.int(net.n)} nodes (${((r.settled / net.n) * 100).toFixed(1)}%) before reaching B. ` +
            'Longer trips settle more of the city, because every node closer than B is finalized first.'));
      }

      // ---- drawing
      function drawSearch(ctx, p, dpr, k, emphasizeFrontier) {
        const tr = S.result.trace;
        const n = Math.floor(tr.length * k);
        const sz = Math.max(1.6, 1.4 * dpr);
        ctx.fillStyle = DL.cssVar('--s-dijkstra');
        ctx.globalAlpha = 0.32;
        const frontier = emphasizeFrontier ? Math.max(0, n - Math.ceil(tr.length * 0.035)) : n;
        for (let i = 0; i < frontier; i++) {
          const v = tr[i];
          ctx.fillRect(p.x(net.lon[v]) - sz / 2, p.y(net.lat[v]) - sz / 2, sz, sz);
        }
        if (frontier < n) {  // the newest nodes (the "wavefront") drawn larger
          ctx.globalAlpha = 1;
          const big = sz * 1.5;
          for (let i = frontier; i < n; i++) {
            const v = tr[i];
            ctx.fillRect(p.x(net.lon[v]) - big / 2, p.y(net.lat[v]) - big / 2, big, big);
          }
        }
        ctx.globalAlpha = 1;
      }
      function drawPath(ctx, p, dpr, width) {
        const r = S.result;
        if (!r || !r.path.length) return;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const line = () => {
          ctx.beginPath();
          r.path.forEach((v, i) => (i ? ctx.lineTo(p.x(net.lon[v]), p.y(net.lat[v])) : ctx.moveTo(p.x(net.lon[v]), p.y(net.lat[v]))));
        };
        line();
        ctx.strokeStyle = DL.cssVar('--map-casing');
        ctx.lineWidth = (width + 3) * dpr;
        ctx.stroke();
        line();
        ctx.strokeStyle = DL.cssVar('--accent');
        ctx.lineWidth = width * dpr;
        ctx.stroke();
      }
      function drawPin(ctx, p, dpr, node, label, fill, text) {
        if (node === null) return;
        const x = p.x(net.lon[node]), y = p.y(net.lat[node]), r = 9 * dpr;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = DL.cssVar('--map-casing');
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.fillStyle = text;
        ctx.font = `600 ${10.5 * dpr}px Geist, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 0.5 * dpr);
      }
      function overlay(ctx, p, dpr) {
        if (S.result && S.result.reachable) {
          drawSearch(ctx, p, dpr, ease(progress), progress < 1);
          if (progress >= 1) drawPath(ctx, p, dpr, 3);
        }
        drawPin(ctx, p, dpr, S.s, 'A', DL.cssVar('--text'), DL.cssVar('--bg'));
        drawPin(ctx, p, dpr, S.t, 'B', DL.cssVar('--accent'), '#ffffff');
      }

      // Animates the settled nodes from 0% to 100% over SWEEP_MS.
      function sweep() {
        cancelAnimationFrame(raf);
        if (!S.result) return;
        sweepStart = performance.now();
        progress = 0;
        const tick = now => {
          if (!alive) return;
          progress = Math.min(1, (now - sweepStart) / SWEEP_MS);
          map.render();
          if (progress < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }

      function onKey(ev) {
        const tag = (ev.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || ev.metaKey || ev.ctrlKey) return;
        if (ev.key === 'r' || ev.key === 'R') randomPair();
        if (ev.key === 'Escape') arm(null);
      }
      document.addEventListener('keydown', onKey);

      (async () => {
        if (!DL.api.live) return;
        net = await DL.api.network();
        if (!alive) return;
        // Keep fitted routes clear of the hint (top) and legend (bottom).
        map = new DL.MapView(canvas, net, { insetTop: 52, insetBottom: 48 });
        host.appendChild(DL.MapView.tools(map));
        map.addOverlay(overlay);
        map.onPick = (lon, lat) => {
          const node = net.nearest(lon, lat);
          if (node < 0) return;
          if (armed === 'a' || (armed === null && S.s === null)) { S.s = node; armed = S.t === null ? 'b' : null; }
          else if (armed === 'b') { S.t = node; armed = null; }
          else return;
          canvas.classList.toggle('pick', !!armed);
          refreshEndpoints();
          if (S.s !== null && S.t !== null) run();
        };
        host.appendChild(h('div.map-legend',
          h('span', h('span.legend-dot', { style: { background: 'var(--s-dijkstra)', opacity: 0.6 } }), 'Settled by Dijkstra'),
          h('span', h('span.legend-line', { style: { background: 'var(--accent)', height: '3px' } }), 'Shortest path')));

        armed = S.s === null && S.t === null ? 'a' : null;
        canvas.classList.toggle('pick', !!armed);
        refreshEndpoints();
        showResult();
        if (S.result) { map.fit(DL.MapView.boundsOf(net, S.result.trace.concat(S.result.path), 0.12)); progress = 1; map.render(); }
        else randomPair();  // first visit: show a real query straight away
      })().catch(e => { if (alive) resultBox.replaceChildren(DL.errorCallout(e)); });

      return () => {
        alive = false;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        if (map) map.destroy();
      };
    },
  };
})();

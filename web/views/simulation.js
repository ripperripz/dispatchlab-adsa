// Simulation: configure a scenario, run it on the engine, and play it back
// with couriers, orders and the event log.
(function () {
  'use strict';
  const DL = window.DL;
  const { h, icon, fmt } = DL;
  const C = window.DLCore;
  DL.views = DL.views || {};
  DL.state = DL.state || {};
  const S = (DL.state.sim = DL.state.sim || {
    params: { couriers: 40, orders: 300, window: 180, seed: 42, policy: 'greedy_eta' },
    run: null, model: null, t: 0, speed: 300, autoRan: false,
  });

  const EV_COLOR = {
    ORDER_CREATED: 'var(--text-3)', FOOD_READY: 'var(--restaurant)', COURIER_ASSIGNED: 'var(--c-to_restaurant)',
    COURIER_ARRIVED_RESTAURANT: 'var(--c-at_restaurant)', ORDER_PICKED_UP: 'var(--c-to_customer)',
    ORDER_DELIVERED: 'var(--c-idle)', COURIER_AVAILABLE: 'var(--c-idle)',
  };
  const EV_TEXT = {
    ORDER_CREATED: e => `Order #${e.order_id} created`,
    FOOD_READY: e => `Food ready for #${e.order_id}`,
    COURIER_ASSIGNED: e => `Courier ${e.courier_id} assigned to #${e.order_id} · ${(e.travel_ms / 60000).toFixed(1)} min away`,
    COURIER_ARRIVED_RESTAURANT: e => `Courier ${e.courier_id} at restaurant for #${e.order_id}`,
    ORDER_PICKED_UP: e => `#${e.order_id} picked up · ${(e.distance_mm / 1e6).toFixed(2)} km to go`,
    ORDER_DELIVERED: e => `#${e.order_id} delivered by courier ${e.courier_id}`,
    COURIER_AVAILABLE: e => `Courier ${e.courier_id} available`,
  };

  DL.views.simulation = {
    mount(root) {
      root.className = 'view fill';
      const ws = h('div.workspace.fade-in');
      root.appendChild(ws);
      const stage = h('div.stage');
      const host = h('div.map-host');
      const canvas = h('canvas.map-canvas', { 'aria-label': 'Map of couriers and orders' });
      host.appendChild(canvas);
      const timeline = h('div.timeline');
      stage.append(host, timeline);
      const insp = h('aside.inspector', { 'aria-label': 'Simulation inspector' });
      ws.append(stage, insp);

      let alive = true, map = null, net = null, raf = 0, last = 0, playing = false, lastK = -1;

      // ---- timeline controls
      const playBtn = h('button.btn.primary.icon', { type: 'button', 'aria-label': 'Play' }, icon('play'));
      const restartBtn = h('button.btn.icon', { type: 'button', 'aria-label': 'Replay from the start' }, icon('restart'));
      const speedCtl = DL.segmented([60, 300, 900, 1800].map(v => ({ value: v, label: `${v}×` })), S.speed, v => { S.speed = v; }, { label: 'Playback speed' });
      const scrubWrap = h('div.scrub-wrap');
      const scrub = h('input.scrub', { type: 'range', min: 0, max: 1000, step: 1000, value: 0, 'aria-label': 'Timeline' });
      const clock = h('span.clock', '00:00:00');
      scrubWrap.appendChild(scrub);
      timeline.append(playBtn, restartBtn, speedCtl, scrubWrap, clock);

      playBtn.addEventListener('click', () => setPlaying(!playing));
      restartBtn.addEventListener('click', () => { S.t = 0; setPlaying(true); });
      scrub.addEventListener('input', () => { S.t = Number(scrub.value); draw(true); });

      // ---- inspector
      const runSection = h('section.insp-section');
      const proofSection = h('section.insp-section');
      const metricsSection = h('section.insp-section', h('h2', 'At the playhead'));
      const metricRows = h('dl.rows', { style: { margin: '0 -16px' } });
      metricsSection.appendChild(metricRows);
      const eventsList = h('ol.events', { 'aria-label': 'Event log' });
      const evCount = h('span.faint', { style: { fontWeight: 400, fontSize: '12px' } });
      const eventsSection = h('section.insp-section.grow', h('h2', 'Event log', evCount), eventsList);
      insp.append(runSection, proofSection, metricsSection, eventsSection);

      const inputs = {
        couriers: DL.numberInput(S.params.couriers, 1, 500),
        orders: DL.numberInput(S.params.orders, 1, 3000),
        window: DL.numberInput(S.params.window, 10, 1440),
        seed: DL.numberInput(S.params.seed, 0, 2147483647),
      };
      const policyCtl = DL.segmented(DL.POLICIES.map(p => ({ value: p.id, label: p.label })), S.params.policy, v => { S.params.policy = v; }, { full: true, label: 'Dispatch policy' });
      const runBtn = h('button.btn.primary', { type: 'button', style: { width: '100%' } }, icon('play'), 'Run simulation');
      const runError = h('div');

      if (DL.api.live) {
        runSection.append(h('h2', 'Scenario'),
          h('div.form-grid',
            DL.field('Couriers', inputs.couriers), DL.field('Orders', inputs.orders),
            DL.field('Order window (min)', inputs.window), DL.field('Seed', inputs.seed)),
          h('div.field', { style: { marginTop: '12px' } }, h('span.label', 'Dispatch policy'), policyCtl),
          h('div', { style: { marginTop: '14px' } }, runBtn), runError);
        runBtn.addEventListener('click', run);
      } else {
        runSection.append(DL.serverRequired('Simulations run on the engine', 'The C++ engine simulates every order, courier and route with Dijkstra.'));
      }

      async function run() {
        const p = {
          couriers: DL.readInt(inputs.couriers, 1, 500), orders: DL.readInt(inputs.orders, 1, 3000),
          window: DL.readInt(inputs.window, 10, 1440), seed: DL.readInt(inputs.seed, 0, 2147483647),
        };
        if (Object.values(p).some(v => v === null)) {
          runError.replaceChildren(h('p', { style: { color: 'var(--err)', fontSize: '12px', marginTop: '8px' } }, 'Fix the highlighted fields: couriers 1–500, orders 1–3000, window 10–1440 min.'));
          return;
        }
        runError.replaceChildren();
        Object.assign(S.params, p);
        runBtn.classList.add('loading');
        runBtn.disabled = true;
        setPlaying(false);
        try {
          const res = await DL.api.get('/api/simulate', { ...S.params });
          if (!alive) return;
          S.run = res;
          S.model = C.buildModel(res.replay, net);
          S.t = 0;
          loadModel();
          setPlaying(true);
        } catch (e) {
          if (alive) runError.replaceChildren(h('div', { style: { marginTop: '10px' } }, DL.errorCallout(e)));
        } finally {
          runBtn.classList.remove('loading');
          runBtn.disabled = false;
        }
      }

      function proof() {
        const m = S.model;
        if (!m) { proofSection.replaceChildren(); return; }
        const r = S.run;
        const rows = h('dl.rows', { style: { margin: '0 -16px' } });
        const row = (k, v) => rows.appendChild(h('div.row', h('dt', k), h('dd', v)));
        row('Policy', DL.POLICIES.find(p => p.id === m.meta.policy)?.label || m.meta.policy);
        row('Scenario', `${m.couriers.length} couriers · ${fmt.int(m.orders.length)} orders · seed ${m.meta.seed}`);
        if (r) {
          row('Delivered', `${fmt.int(r.metrics.orders_delivered)} of ${fmt.int(r.metrics.orders_total)} · average ${fmt.min(r.metrics.avg_delivery_min)}`);
          row('Engine time', `${fmt.num(r.sim_wall_ms, 0)} ms · ${fmt.int(r.metrics.events)} events`);
        }
        proofSection.replaceChildren(h('h2', 'Run'), rows);
      }

      function loadModel() {
        const m = S.model;
        proof();
        scrub.max = String(m.endTime);
        scrub.step = '1000';
        const delivered = m.events.filter(e => e.event === 'ORDER_DELIVERED').map(e => e.timestamp);
        scrubWrap.querySelector('svg')?.remove();
        scrubWrap.insertBefore(DL.charts.cumulativeArea(delivered, m.endTime, 'var(--c-idle)'), scrub);
        evCount.textContent = `${fmt.int(m.events.length)} events`;
        lastK = -1;
        draw(true);
      }

      // ---- playback
      function setPlaying(on) {
        playing = on && !!S.model;
        playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
        playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        if (playing && S.t >= S.model.endTime) S.t = 0;
        last = 0;
        cancelAnimationFrame(raf);
        if (playing) raf = requestAnimationFrame(tick);
      }
      function tick(now) {
        if (!alive || !playing) return;
        const dt = last ? now - last : 0;
        last = now;
        S.t = Math.min(S.model.endTime, S.t + dt * S.speed);
        draw(false);
        if (S.t >= S.model.endTime) { setPlaying(false); return; }
        raf = requestAnimationFrame(tick);
      }

      let state = null;
      function draw(force) {
        if (!S.model || !map) return;
        state = C.stateAt(S.model, S.t);
        map.renderNow();
        scrub.value = String(Math.round(S.t));
        clock.textContent = fmt.clock(S.t);
        const mt = state.metrics;
        metricRows.replaceChildren(
          ...[['Simulated time', fmt.clock(S.t)], ['Orders created', `${fmt.int(mt.created)} / ${fmt.int(mt.totalOrders)}`],
            ['Delivered', fmt.int(mt.delivered)], ['Average delivery', mt.delivered ? fmt.min(mt.avgDeliveryMin) : '–'],
            ['Waiting for a courier', fmt.int(mt.pending)], ['Active deliveries', fmt.int(mt.active)],
            ['Available couriers', `${mt.available} / ${S.model.couriers.length}`]]
            .map(([k, v]) => h('div.row', h('dt', k), h('dd', v))));
        if (force || state.eventCount !== lastK) renderEvents(state.eventCount);
      }

      function renderEvents(k) {
        lastK = k;
        const m = S.model;
        const from = Math.max(0, k - 120), to = Math.min(m.events.length, k + 12);
        const frag = [];
        for (let i = from; i < to; i++) {
          const e = m.events[i];
          const li = h('li', { class: i >= k ? 'future' : i === k - 1 ? 'current' : null, title: `seq ${e.seq}` },
            h('span.t', fmt.clock(e.timestamp)),
            h('span.e', h('span.ev-tag', { style: { background: EV_COLOR[e.event] } }), EV_TEXT[e.event](e)));
          li.addEventListener('click', () => { S.t = e.timestamp; draw(true); });
          frag.push(li);
        }
        eventsList.replaceChildren(...frag);
        // Scroll only the list (scrollIntoView would also scroll the inspector).
        const cur = eventsList.querySelector('.current');
        if (cur) eventsList.scrollTop = cur.offsetTop - eventsList.offsetTop - eventsList.clientHeight + cur.offsetHeight * 3;
      }

      function overlay(ctx, p, dpr) {
        if (!state) return;
        const m = S.model;
        // Routes in flight (remaining part only).
        ctx.lineWidth = 1.6 * dpr;
        ctx.lineJoin = 'round';
        for (const c of state.couriers) {
          if (!c.leg) continue;
          ctx.strokeStyle = DL.cssVar(c.status === 'to_customer' ? '--c-to_customer' : '--c-to_restaurant');
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(p.x(c.lon), p.y(c.lat));
          const f = (S.t - c.leg.t0) / Math.max(1, c.leg.t1 - c.leg.t0);
          for (let i = 0; i < c.leg.path.length; i++) {
            if (c.leg.cum[i] < f) continue;
            const v = c.leg.path[i];
            ctx.lineTo(p.x(m.lon[v]), p.y(m.lat[v]));
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // Restaurants.
        ctx.fillStyle = DL.cssVar('--restaurant');
        const rs = 3.5 * dpr;
        for (const r of m.restaurants) ctx.fillRect(p.x(m.lon[r.node]) - rs, p.y(m.lat[r.node]) - rs, rs * 2, rs * 2);
        // Customers with an open order.
        ctx.strokeStyle = DL.cssVar('--customer');
        ctx.lineWidth = 1.8 * dpr;
        for (const o of state.orders) {
          if (o.status === 'not_created' || o.status === 'delivered') continue;
          const node = m.customers[m.orders[o.id].customer].node;
          ctx.beginPath();
          ctx.arc(p.x(m.lon[node]), p.y(m.lat[node]), 4 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Couriers.
        const casing = DL.cssVar('--map-casing');
        for (const c of state.couriers) {
          const x = p.x(c.lon), y = p.y(c.lat);
          ctx.beginPath();
          ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = casing;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, 3.6 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = DL.cssVar('--c-' + c.status);
          ctx.fill();
        }
      }

      function onKey(ev) {
        const tag = (ev.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || ev.metaKey || ev.ctrlKey) return;
        if (ev.key === ' ') { ev.preventDefault(); setPlaying(!playing); }
      }
      document.addEventListener('keydown', onKey);

      (async () => {
        if (!DL.api.live) return;
        net = await DL.api.network();
        if (!alive) return;
        if (!net) {
          return;
        }
        map = new DL.MapView(canvas, net);
        host.appendChild(DL.MapView.tools(map));
        map.addOverlay(overlay);
        host.appendChild(h('div.map-legend',
          ...[['idle', 'Idle'], ['to_restaurant', 'To restaurant'], ['at_restaurant', 'Waiting for food'], ['to_customer', 'Delivering']]
            .map(([k, label]) => h('span', h('span.legend-dot', { style: { background: `var(--c-${k})` } }), label)),
          h('span', h('span.legend-sq', { style: { background: 'var(--restaurant)' } }), 'Restaurant'),
          h('span', h('span.legend-ring'), 'Customer awaiting order')));

        if (S.model) loadModel();
        else if (DL.api.live && !S.autoRan) { S.autoRan = true; run(); }
        else {
          proofSection.replaceChildren(h('p.muted', { style: { fontSize: '13px' } }, 'Run a scenario to see it here.'));
        }
      })().catch(e => { if (alive) runError.replaceChildren(DL.errorCallout(e)); });

      return () => {
        alive = false;
        playing = false;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        if (map) map.destroy();
      };
    },
  };
})();

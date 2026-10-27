// DispatchLab viewer core: pure functions over a replay document
// (format "dispatchlab-replay-1"). No DOM access, so it also runs under Node
// for viewer/selftest.mjs. Exposed as globalThis.DLCore.
(function (root) {
  'use strict';

  const STATUS = { IDLE: 'idle', TO_RESTAURANT: 'to_restaurant', AT_RESTAURANT: 'at_restaurant', TO_CUSTOMER: 'to_customer' };
  const ORDER = { NOT_CREATED: 'not_created', PENDING: 'pending', ASSIGNED: 'assigned', PICKED_UP: 'picked_up', DELIVERED: 'delivered' };

  // `net` (optional) supplies the network when the document omits it, as the
  // live console's /api/simulate does: {n, lon, lat, edges, arterial, bbox}.
  function buildModel(doc, net) {
    if (!doc || doc.format !== 'dispatchlab-replay-1') throw new Error('not a DispatchLab replay (format tag missing)');
    let n, lon, lat;
    if (doc.nodes) {
      n = doc.nodes.length / 2;
      lon = new Float64Array(n);
      lat = new Float64Array(n);
      for (let i = 0; i < n; i++) { lon[i] = doc.nodes[2 * i]; lat[i] = doc.nodes[2 * i + 1]; }
    } else if (net) {
      ({ n, lon, lat } = net);
    } else {
      throw new Error('replay has no network and none was supplied');
    }
    const model = {
      meta: doc.meta,
      bbox: doc.bbox || (net && net.bbox),
      n, lon, lat,
      edges: doc.edges || (net && net.edges),
      edgeArterial: doc.edge_arterial || (net && net.arterial),
      restaurants: doc.restaurants.map(([id, node]) => ({ id, node })),
      customers: doc.customers.map(([id, node]) => ({ id, node })),
      couriers: doc.couriers.map(([id, node]) => ({ id, node })),
      orders: doc.orders.map(([id, restaurant, customer, created, prep]) => ({ id, restaurant, customer, created, prep })),
      events: doc.events,
      endTime: doc.meta.end_time,
      legs: [],   // movement legs: {courier, t0, t1, path, cum (cumulative fraction per path node)}
    };
    for (const e of model.events) {
      if ((e.event === 'COURIER_ASSIGNED' || e.event === 'ORDER_PICKED_UP') && e.path && e.path.length) {
        model.legs.push(makeLeg(model, e));
      }
    }
    // Index legs per courier (in time order) for fast lookup.
    model.legsByCourier = model.couriers.map(() => []);
    for (const leg of model.legs) model.legsByCourier[leg.courier].push(leg);
    return model;
  }

  function dist(model, a, b) {
    const k = Math.cos(model.lat[a] * Math.PI / 180);
    const dx = (model.lon[b] - model.lon[a]) * k;
    const dy = model.lat[b] - model.lat[a];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function makeLeg(model, e) {
    const path = e.path;
    const cum = new Float64Array(path.length);
    let total = 0;
    for (let i = 1; i < path.length; i++) { total += dist(model, path[i - 1], path[i]); cum[i] = total; }
    if (total > 0) for (let i = 1; i < path.length; i++) cum[i] /= total;
    return { courier: e.courier_id, order: e.order_id, kind: e.event, t0: e.timestamp, t1: e.timestamp + e.travel_ms, path, cum };
  }

  // Position along a leg at time t (linear in geometric distance; the simulator
  // only fixes departure and arrival times, so this is a display approximation).
  function legPosition(model, leg, t) {
    const f = leg.t1 > leg.t0 ? Math.min(1, Math.max(0, (t - leg.t0) / (leg.t1 - leg.t0))) : 1;
    const p = leg.path, c = leg.cum;
    if (p.length === 1) return [model.lon[p[0]], model.lat[p[0]]];
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= f) lo = mid; else hi = mid; }
    const span = c[hi] - c[lo];
    const u = span > 0 ? (f - c[lo]) / span : 0;
    return [model.lon[p[lo]] + u * (model.lon[p[hi]] - model.lon[p[lo]]),
            model.lat[p[lo]] + u * (model.lat[p[hi]] - model.lat[p[lo]])];
  }

  // Index of the first event with timestamp > t (events are time-sorted).
  function eventsUpTo(model, t) {
    let lo = 0, hi = model.events.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (model.events[mid].timestamp <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // Full state at simulated time t, recomputed by folding events [0, k).
  function stateAt(model, t) {
    const k = eventsUpTo(model, t);
    const couriers = model.couriers.map(c => ({ id: c.id, node: c.node, status: STATUS.IDLE, order: -1, leg: null }));
    const orders = model.orders.map(o => ({ id: o.id, status: ORDER.NOT_CREATED, courier: -1, created: o.created, delivered: -1, ready: false }));
    let created = 0, delivered = 0, sumDelivery = 0;
    const legIdx = model.couriers.map(() => 0);
    for (let i = 0; i < k; i++) {
      const e = model.events[i];
      const o = e.order_id >= 0 ? orders[e.order_id] : null;
      const c = e.courier_id >= 0 ? couriers[e.courier_id] : null;
      switch (e.event) {
        case 'ORDER_CREATED': o.status = ORDER.PENDING; created++; break;
        case 'FOOD_READY': o.ready = true; break;
        case 'COURIER_ASSIGNED':
          o.status = ORDER.ASSIGNED; o.courier = e.courier_id;
          c.status = STATUS.TO_RESTAURANT; c.order = e.order_id;
          c.leg = model.legsByCourier[e.courier_id][legIdx[e.courier_id]++] || null;
          break;
        case 'COURIER_ARRIVED_RESTAURANT': c.status = STATUS.AT_RESTAURANT; c.node = e.location; c.leg = null; break;
        case 'ORDER_PICKED_UP':
          o.status = ORDER.PICKED_UP; c.status = STATUS.TO_CUSTOMER;
          c.leg = model.legsByCourier[e.courier_id][legIdx[e.courier_id]++] || null;
          break;
        case 'ORDER_DELIVERED':
          o.status = ORDER.DELIVERED; o.delivered = e.timestamp; c.node = e.location; c.leg = null;
          delivered++; sumDelivery += e.timestamp - o.created;
          break;
        case 'COURIER_AVAILABLE': c.status = STATUS.IDLE; c.order = -1; break;
        default: throw new Error('unknown event ' + e.event);
      }
    }
    for (const c of couriers) {
      const pos = c.leg ? legPosition(model, c.leg, t) : [model.lon[c.node], model.lat[c.node]];
      c.lon = pos[0]; c.lat = pos[1];
    }
    let pending = 0, active = 0;
    for (const o of orders) {
      if (o.status === ORDER.PENDING) pending++;
      else if (o.status === ORDER.ASSIGNED || o.status === ORDER.PICKED_UP) active++;
    }
    const available = couriers.filter(c => c.status === STATUS.IDLE).length;
    return {
      t, eventCount: k, couriers, orders,
      metrics: {
        totalOrders: model.orders.length, created, delivered, pending, active, available,
        avgDeliveryMin: delivered ? sumDelivery / delivered / 60000 : 0,
      },
    };
  }

  // Fit-to-box equirectangular projection (cos(lat) corrected).
  function makeProjection(bbox, width, height, pad) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const w = (maxLon - minLon) * k, h = maxLat - minLat;
    const s = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = (width - w * s) / 2, oy = (height - h * s) / 2;
    return {
      x: lon => ox + (lon - minLon) * k * s,
      y: lat => height - (oy + (lat - minLat) * s),
      scale: s,
    };
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function describeEvent(e) {
    const who = e.courier_id >= 0 ? ' courier #' + e.courier_id : '';
    const what = e.order_id >= 0 ? ' order #' + e.order_id : '';
    const extra = e.travel_ms !== undefined ? ' (' + (e.travel_ms / 60000).toFixed(1) + ' min, ' + (e.distance_mm / 1e6).toFixed(2) + ' km)' : '';
    return formatTime(e.timestamp) + '  ' + e.event + what + who + extra;
  }

  root.DLCore = { buildModel, stateAt, eventsUpTo, legPosition, makeProjection, formatTime, describeEvent, STATUS, ORDER };
})(typeof globalThis !== 'undefined' ? globalThis : this);

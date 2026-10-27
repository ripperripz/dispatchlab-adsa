// Talks to the C++ engine (`dispatchlab serve`) on the same address.
// Only relative /api/ paths are ever requested.
(function () {
  'use strict';
  const DL = (window.DL = window.DL || {});

  const api = {
    live: false,
    info: null,

    // Checks that the engine answers. Resolves to true or false.
    async connect() {
      if (!location.protocol.startsWith('http')) return (this.live = false);
      try {
        this.info = await this.get('/api/info', null, 4000);
        this.live = true;
      } catch (e) {
        this.live = false;
      }
      return this.live;
    },

    async get(path, params, timeoutMs = 120000) {
      if (!path.startsWith('/api/')) throw new Error('invalid API path');
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(path + qs, { signal: ctl.signal, cache: 'no-store' });
      } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'The engine took too long to answer.' : 'Cannot reach the engine. Is `dispatchlab serve` still running?');
      } finally {
        clearTimeout(timer);
      }
      let body = null;
      try { body = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
      return body;
    },

    // Road network as typed arrays plus a nearest-node index (loaded once).
    async network() {
      if (!this._net) this._net = DL.buildNetwork(await this.get('/api/network', null, 60000));
      return this._net;
    },
  };

  // Network container shared by every map.
  DL.buildNetwork = function (raw) {
    const n = raw.nodes.length / 2;
    const lon = new Float64Array(n), lat = new Float64Array(n);
    for (let i = 0; i < n; i++) { lon[i] = raw.nodes[2 * i]; lat[i] = raw.nodes[2 * i + 1]; }
    const edges = Int32Array.from(raw.edges);
    const arterial = Uint8Array.from(raw.edge_arterial);
    const bbox = raw.bbox;
    // Grid of buckets so a map click finds the nearest road node quickly.
    const G = 128;
    const cellW = (bbox[2] - bbox[0]) / G || 1, cellH = (bbox[3] - bbox[1]) / G || 1;
    const buckets = Array.from({ length: G * G }, () => []);
    const cellOf = (x, y) => [Math.min(G - 1, Math.max(0, Math.floor((x - bbox[0]) / cellW))), Math.min(G - 1, Math.max(0, Math.floor((y - bbox[1]) / cellH)))];
    for (let i = 0; i < n; i++) { const [cx, cy] = cellOf(lon[i], lat[i]); buckets[cy * G + cx].push(i); }
    const k = Math.cos(((bbox[1] + bbox[3]) / 2) * Math.PI / 180);
    function nearest(x, y) {
      const [cx, cy] = cellOf(x, y);
      let best = -1, bestD = Infinity;
      for (let r = 0; r < G; r++) {
        for (let gy = cy - r; gy <= cy + r; gy++) {
          for (let gx = cx - r; gx <= cx + r; gx++) {
            if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
            if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r) continue;
            for (const i of buckets[gy * G + gx]) {
              const dx = (lon[i] - x) * k, dy = lat[i] - y, d = dx * dx + dy * dy;
              if (d < bestD) { bestD = d; best = i; }
            }
          }
        }
        if (best >= 0 && r >= 1) break;
      }
      return best;
    }
    return { n, lon, lat, edges, arterial, bbox, nearest };
  };

  // Shown when the page is opened without the engine running.
  DL.serverRequired = function (title, body) {
    const { h, icon } = DL;
    return h('div.empty.fade-in',
      h('span.badge.warn', icon('bolt'), 'Needs the engine'),
      h('h3', title),
      h('p', body),
      DL.command('./run.sh'),
      h('p.faint', 'Then open http://127.0.0.1:8080 in your browser.'));
  };

  DL.api = api;
})();

// Canvas map of the road network with pan/zoom and an overlay callback.
// Roads are rasterized into an offscreen layer per view; during a drag the
// cached layer is translated and re-rendered once the gesture settles.
(function () {
  'use strict';
  const DL = (window.DL = window.DL || {});

  class MapView {
    constructor(canvas, net, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.net = net;
      this.opts = Object.assign({ interactive: true, padding: 24, roadScale: 1 }, opts);
      this.view = { zoom: 1, panX: 0, panY: 0 };
      this.frame = net.bbox;     // lon/lat box the base projection fits
      this.overlays = [];
      this.layer = null;         // cached road raster
      this.layerView = null;
      this.raf = 0;
      this.onPick = null;
      this._bind();
      this.resize();
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      this._theme = () => { this.layer = null; this.render(); };
      window.addEventListener('dl-theme', this._theme);
    }

    destroy() {
      this._ro.disconnect();
      window.removeEventListener('dl-theme', this._theme);
      cancelAnimationFrame(this.raf);
      this.canvas.replaceWith(this.canvas.cloneNode(false));
    }

    get dpr() { return window.devicePixelRatio || 1; }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * this.dpr)), hgt = Math.max(1, Math.round(r.height * this.dpr));
      if (w === this.canvas.width && hgt === this.canvas.height) return;
      this.canvas.width = w;
      this.canvas.height = hgt;
      this.layer = null;
      this.render();
    }

    // Fits the base projection to a lon/lat box and resets pan/zoom.
    fit(bbox) {
      this.frame = bbox || this.net.bbox;
      this.view = { zoom: 1, panX: 0, panY: 0 };
      this.layer = null;
      this.render();
    }

    base() {
      const [minLon, minLat, maxLon, maxLat] = this.frame;
      const W = this.canvas.width, H = this.canvas.height, pad = this.opts.padding * this.dpr;
      // Optional insets keep fitted content clear of overlay chrome at the top/bottom.
      const top = pad + (this.opts.insetTop || 0) * this.dpr, bottom = pad + (this.opts.insetBottom || 0) * this.dpr;
      const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
      const w = Math.max(1e-9, (maxLon - minLon) * k), hh = Math.max(1e-9, maxLat - minLat);
      const s = Math.min((W - 2 * pad) / w, Math.max(1, H - top - bottom) / hh);
      const ox = (W - w * s) / 2, oy = bottom + (H - top - bottom - hh * s) / 2;
      return { k, s, ox, oy, minLon, minLat, H };
    }

    // Projection for the current view: lon/lat -> device pixels.
    projection() {
      const b = this.base(), v = this.view, cx = this.canvas.width / 2, cy = this.canvas.height / 2;
      const sx = b.k * b.s * v.zoom, sy = b.s * v.zoom;
      const tx = (b.ox - cx) * v.zoom + cx + v.panX - b.minLon * sx;
      const ty = b.H - b.oy;  // pre-zoom y origin
      return {
        x: lon => lon * sx + tx,
        y: lat => (ty - (lat - b.minLat) * b.s - cy) * v.zoom + cy + v.panY,
        invert: (px, py) => [
          (px - tx) / sx,
          b.minLat + (ty - ((py - v.panY - cy) / v.zoom + cy)) / b.s,
        ],
        scale: sy,
      };
    }

    addOverlay(fn) { this.overlays.push(fn); this.render(); return fn; }
    removeOverlay(fn) { this.overlays = this.overlays.filter(f => f !== fn); this.render(); }

    render() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this._draw(); });
    }
    renderNow() { cancelAnimationFrame(this.raf); this.raf = 0; this._draw(); }

    _drawRoads() {
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d');
      const p = this.projection();
      const { lon, lat, edges, arterial } = this.net;
      const css = DL.cssVar;
      const zoomBoost = Math.min(2.2, 0.75 + Math.sqrt(this.view.zoom) * 0.35) * this.opts.roadScale;
      g.lineCap = 'round';
      for (const pass of [0, 1]) {
        g.beginPath();
        g.strokeStyle = css(pass ? '--map-arterial' : '--map-road');
        g.lineWidth = (pass ? 1.25 : 0.7) * this.dpr * zoomBoost;
        const W = c.width, H = c.height;
        for (let i = 0; i < arterial.length; i++) {
          if (arterial[i] !== pass) continue;
          const a = edges[2 * i], b = edges[2 * i + 1];
          const x1 = p.x(lon[a]), y1 = p.y(lat[a]), x2 = p.x(lon[b]), y2 = p.y(lat[b]);
          if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > W && x2 > W) || (y1 > H && y2 > H)) continue;
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
        }
        g.stroke();
      }
      this.layer = c;
      this.layerView = { ...this.view };
    }

    _draw() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = DL.cssVar('--map-bg');
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.layer) this._drawRoads();
      const lv = this.layerView, v = this.view;
      if (lv.zoom === v.zoom) {
        ctx.drawImage(this.layer, v.panX - lv.panX, v.panY - lv.panY);
      } else {
        // Mid-gesture zoom: scale the cached layer about the canvas centre.
        const f = v.zoom / lv.zoom, cx = this.canvas.width / 2, cy = this.canvas.height / 2;
        ctx.setTransform(f, 0, 0, f, (cx + v.panX) - f * (cx + lv.panX), (cy + v.panY) - f * (cy + lv.panY));
        ctx.drawImage(this.layer, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      const p = this.projection();
      for (const fn of this.overlays) {
        ctx.save();
        fn(ctx, p, this.dpr);
        ctx.restore();
      }
    }

    _settle() {
      clearTimeout(this._settleTimer);
      this._settleTimer = setTimeout(() => { this.layer = null; this.render(); }, 140);
    }

    zoomBy(f, px, py) {
      const nz = Math.min(60, Math.max(0.6, this.view.zoom * f));
      const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
      const mx = (px ?? cx) - cx, my = (py ?? cy) - cy;
      this.view.panX = mx - (mx - this.view.panX) * (nz / this.view.zoom);
      this.view.panY = my - (my - this.view.panY) * (nz / this.view.zoom);
      this.view.zoom = nz;
      this.render();
      this._settle();
    }

    _bind() {
      const cv = this.canvas;
      if (!this.opts.interactive) return;
      cv.addEventListener('wheel', ev => {
        ev.preventDefault();
        const r = cv.getBoundingClientRect();
        this.zoomBy(Math.exp(-ev.deltaY * 0.0016), (ev.clientX - r.left) * this.dpr, (ev.clientY - r.top) * this.dpr);
      }, { passive: false });
      let drag = null;
      cv.addEventListener('pointerdown', ev => {
        drag = { x: ev.clientX, y: ev.clientY, px: this.view.panX, py: this.view.panY, moved: false };
        cv.setPointerCapture(ev.pointerId);
      });
      cv.addEventListener('pointermove', ev => {
        if (!drag) return;
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        cv.classList.add('dragging');
        this.view.panX = drag.px + dx * this.dpr;
        this.view.panY = drag.py + dy * this.dpr;
        this.render();
      });
      cv.addEventListener('pointerup', ev => {
        if (drag && !drag.moved && this.onPick) {
          const r = cv.getBoundingClientRect();
          const [lon, lat] = this.projection().invert((ev.clientX - r.left) * this.dpr, (ev.clientY - r.top) * this.dpr);
          this.onPick(lon, lat);
        }
        if (drag && drag.moved) this._settle();
        drag = null;
        cv.classList.remove('dragging');
      });
      cv.addEventListener('dblclick', ev => {
        const r = cv.getBoundingClientRect();
        this.zoomBy(2, (ev.clientX - r.left) * this.dpr, (ev.clientY - r.top) * this.dpr);
      });
    }
  }

  // +/−/fit control cluster for a map.
  MapView.tools = function (map) {
    const { h, icon } = DL;
    return h('div.map-tools',
      h('button', { type: 'button', 'aria-label': 'Zoom in', onclick: () => map.zoomBy(1.6) }, icon('plus')),
      h('button', { type: 'button', 'aria-label': 'Zoom out', onclick: () => map.zoomBy(1 / 1.6) }, icon('minus')),
      h('button', { type: 'button', 'aria-label': 'Fit to network', onclick: () => map.fit(map.frame) }, icon('fit')));
  };

  // Lon/lat bounding box of a list of node ids, expanded by `pad` (fraction).
  MapView.boundsOf = function (net, ids, pad = 0.15) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const i of ids) {
      a = Math.min(a, net.lon[i]); c = Math.max(c, net.lon[i]);
      b = Math.min(b, net.lat[i]); d = Math.max(d, net.lat[i]);
    }
    if (!Number.isFinite(a)) return net.bbox;
    const w = Math.max(c - a, 0.004), hh = Math.max(d - b, 0.004);
    return [a - w * pad, b - hh * pad, c + w * pad, d + hh * pad];
  };

  DL.MapView = MapView;
})();
